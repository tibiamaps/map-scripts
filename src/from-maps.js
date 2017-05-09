'use strict';

const fs = require('fs');
const glob = require('glob');
const path = require('path');

const Canvas = require('canvas');
const Image = Canvas.Image;
const range = require('lodash.range');
const sortObject = require('sort-object');
const windows1252 = require('windows-1252');

const idToXyz = require('./id-to-xyz.js');

const GLOBALS = {};
const resetContext = function(context, fillStyle) {
	context.fillStyle = fillStyle;
	context.fillRect(0, 0, GLOBALS.bounds.width, GLOBALS.bounds.height);
};

const icons = require('./icons.js');
const colors = require('./colors.js');
const writeJSON = require('./write-json.js');
const saveCanvasToPNG = require('./save-canvas-to-png.js');
const handleSequence = require('./handle-sequence.js');

const mapPixelPalette = {};
const pixelCanvas = new Canvas(1, 1);
const pixelContext = pixelCanvas.getContext('2d');
Object.keys(colors.byByte).forEach(function(pixelByte) {
	const color = colors.byByte[pixelByte];
	const imageData = pixelContext.createImageData(1, 1);
	const data = imageData.data;
	data[0] = color.r;
	data[1] = color.g;
	data[2] = color.b;
	data[3] = 0xFF;
	mapPixelPalette[pixelByte] = imageData;
});

const pathPixelPalette = {};
for (const pixelByte of range(0, 255 + 1)) {
	const isNonWalkable = pixelByte == colors.nonWalkablePathByte;
	const component = pixelByte;
	const color = isNonWalkable ? colors.nonWalkablePath : {
		'r': component,
		'g': component,
		'b': component
	};
	const imageData = pixelContext.createImageData(1, 1);
	const data = imageData.data;
	data[0] = color.r;
	data[1] = color.g;
	data[2] = color.b;
	data[3] = 0xFF;
	pathPixelPalette[pixelByte] = imageData;
}
// Add the special color for unexplored paths.
const imageData = pixelContext.createImageData(1, 1);
const data = imageData.data;
data[0] = colors.unexploredPath.r;
data[1] = colors.unexploredPath.g;
data[2] = colors.unexploredPath.b;
data[3] = 0xFF;
pathPixelPalette[colors.unexploredPathByte] = imageData;

let markers = {};
const resetMarkers = function() {
	markers = {};
};

const renderMap = function(buffer) {
	const canvas = new Canvas(256, 256);
	const context = canvas.getContext('2d');
	let xIndex = -1;
	let bufferIndex = -1;
	while (++xIndex < 256) {
		let yIndex = -1;
		while (++yIndex < 256) {
			const pixelByte = buffer[++bufferIndex];
			const pixel = mapPixelPalette[pixelByte];
			console.assert(pixel, `Unknown color ID: ${pixelByte}`);
			context.putImageData(mapPixelPalette[pixelByte], xIndex, yIndex);
		}
	}
	const imageData = context.getImageData(0, 0, 256, 256);
	return imageData;
};

const renderPath = function(buffer) {
	const canvas = new Canvas(256, 256);
	const context = canvas.getContext('2d');
	let xIndex = -1;
	let bufferIndex = -1;
	while (++xIndex < 256) {
		let yIndex = -1;
		while (++yIndex < 256) {
			const pixelByte = buffer[++bufferIndex];
			context.putImageData(pathPixelPalette[pixelByte], xIndex, yIndex);
		}
	}
	const imageData = context.getImageData(0, 0, 256, 256);
	return imageData;
};

const parseMarkerData = function(buffer, floor) {
	// https://tibiamaps.io/guides/map-file-format#map-marker-data
	const markers = [];
	let index = 0;
	// The first 4 bytes indicate the number of markers on the map.
	const markerCount = buffer.readUIntLE(index, 4);
	index += 4;
	// If there are no markers, our work is done here.
	if (markerCount == 0) {
		return markers;
	}

	// For each marker…
	while (markers.length < markerCount) {
		const marker = {};
		// The first byte is the `x` offset within this 256×256px tile.
		const xOffset = buffer.readUInt8(index++, 1);
		// The second byte is the map tile it is in on the `x` axis.
		const xTile = buffer.readUInt8(index++, 1);
		marker.x = xTile * 256 + xOffset;
		// The next two bytes are blank.
		console.assert(index++, 0x00);
		console.assert(index++, 0x00);

		// The next byte is the `y` offset within this 256×256px tile.
		const yOffset = buffer.readUInt8(index++, 1);
		// The next byte is the map tile it is in on the `y` axis.
		const yTile = buffer.readUInt8(index++, 1);
		marker.y = yTile * 256 + yOffset;
		// The next two bytes are blank.
		console.assert(index++, 0x00);
		console.assert(index++, 0x00);

		// Include the floor number in the JSON data so that it doesn’t have to be
		// inferred from the file name.
		marker.z = floor;

		// The next 4 bytes are the image ID of the marker icon.
		const id = buffer.readUIntLE(index, 4);
		index += 4;
		marker.icon = icons.byID[id];

		// The next 2 bytes indicate the size of the string that follows.
		const descriptionLength = buffer.readUIntLE(index, 2);
		index += 2;

		// Read the string, i.e. the marker’s description. Only symbols that can be
		// represented using the windows-1252 encoding are supported.
		const descriptionBuffer = buffer.slice(index, index + descriptionLength);
		index += descriptionLength;
		marker.description = windows1252.decode(
			descriptionBuffer.toString('binary')
		);

		const sorted = sortObject(marker);
		markers.push(sorted);
	}

	// Sort markers so they start in the top left, then go from top to bottom.
	// This matches the order of the keys in the root object, where e.g.
	// `12412407` appears before `12412507` which appears before `12512407`.
	// Example:
	//     · 2 · 4 · · ·
	//     1 · 3 · · · 7
	//     · · · 5 · 6 ·
	markers.sort((a, b) => {
		return (a.x * 100000 + a.y) - (b.x * 100000 + b.y);
	});

	// Remove duplicate markers.
	const set = new Set();
	const uniqueMarkers = markers.filter(function(marker) {
		const serialized = JSON.stringify(marker).toLowerCase();
		const isDuplicate = set.has(serialized);
		set.add(serialized);
		return !isDuplicate;
	});
	return uniqueMarkers;
};

const drawMapSection = function(fileName, includeMarkers) {
	return new Promise(function(resolve, reject) {

		const id = path.basename(fileName, '.map');
		const coordinates = idToXyz(id);
		const xOffset = (coordinates.x - GLOBALS.bounds.xMin) * 256;
		const yOffset = (coordinates.y - GLOBALS.bounds.yMin) * 256;

		fs.readFile(fileName, function(error, buffer) {

			if (error) {
				reject(error);
			}

			// The first 0x10000 (256×256) bytes of the map file form the graphical
			// portion of the map. Each byte represents a single visible map pixel.
			// https://tibiamaps.io/guides/map-file-format#visual-map-data
			const mapData = buffer.slice(0, 0x10000);
			const mapImageData = renderMap(mapData);
			GLOBALS.mapContext.putImageData(mapImageData, xOffset, yOffset);

			// The next 0x10000 bytes form the map that is used for pathfinding. Each
			// of these 256×256 bytes represents the walking speed on a specific tile.
			// In general, the lower the value, the higher your movement speed on that
			// tile. There are two known constants:
			// 0xFA = unexplored/unknown
			// 0xFF = non-walkable
			// https://tibiamaps.io/guides/map-file-format#pathfinding-data
			const pathData = buffer.slice(0x10000, 0x20000);
			const pathImageData = renderPath(pathData);
			GLOBALS.pathContext.putImageData(pathImageData, xOffset, yOffset);

			// The remaining bytes are map marker data.
			// https://tibiamaps.io/guides/map-file-format#map-marker-data
			const markerData = buffer.slice(0x20000);
			if (!markerData.length) {
				// In the TibiaMaps.org package, `12712113.map` lacks the 4 null bytes
				// at the end to indicate it has no markers.
				console.warn(`File with invalid marker data: ${fileName}. Fix:`);
				console.log(`printf '\\0\\0\\0\\0' >> ${fileName}`);
			}

			if (includeMarkers) {
				const results = parseMarkerData(markerData, coordinates.z);
				if (results.length) {
					markers[id] = results;
				}
			}

			resolve();

		});

	});
};

const renderFloor = function(floorID, mapDirectory, dataDirectory, includeMarkers) {
	console.log(`Rendering floor ${floorID}…`);
	return new Promise(function(resolve, reject) {
		const unexploredMap = colors.unexploredMap;
		resetContext(
			GLOBALS.mapContext,
			`rgb(${unexploredMap.r}, ${unexploredMap.g}, ${unexploredMap.b}`
		);
		const unexploredPath = colors.unexploredPath;
		resetContext(
			GLOBALS.pathContext,
			`rgb(${unexploredPath.r}, ${unexploredPath.g}, ${unexploredPath.b}`
		);
		resetMarkers();
		glob(`${mapDirectory}/*${floorID}.map`, function(error, files) {
			// Handle all map files for this floor sequentially.
			handleSequence(files, function(fileName) {
				return drawMapSection(fileName, includeMarkers);
			}).then(function() {
				return saveCanvasToPNG(
					`${dataDirectory}/floor-${floorID}-map.png`,
					GLOBALS.mapCanvas
				);
			}).then(function() {
				return saveCanvasToPNG(
					`${dataDirectory}/floor-${floorID}-path.png`,
					GLOBALS.pathCanvas
				);
			}).then(function() {
				return writeJSON(
					`${dataDirectory}/floor-${floorID}-markers.json`,
					includeMarkers ? markers : {}
				);
			}).then(function() {
				resolve();
			}).catch(function(error) {
				console.error(error.stack);
				reject(error);
			});
		});
	});
};

const convertFromMaps = function(bounds, mapDirectory, dataDirectory, includeMarkers) {
	GLOBALS.bounds = bounds;
	GLOBALS.mapCanvas = new Canvas(bounds.width, bounds.height);
	GLOBALS.mapContext = GLOBALS.mapCanvas.getContext('2d');
	GLOBALS.pathCanvas = new Canvas(bounds.width, bounds.height);
	GLOBALS.pathContext = GLOBALS.pathCanvas.getContext('2d');
	if (!mapDirectory) {
		mapDirectory = 'Automap';
	}
	if (!dataDirectory) {
		dataDirectory = 'data';
	}
	handleSequence(bounds.floorIDs, function(floorID) {
		return renderFloor(floorID, mapDirectory, dataDirectory, includeMarkers);
	});
};

module.exports = convertFromMaps;
