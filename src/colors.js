'use strict';

const byByte = {
	0x00: { r: 0, g: 0, b: 0 }, // black (empty)
	0x0C: { r: 0, g: 102, b: 0 }, // dark green (tree)
	0x18: { r: 0, g: 204, b: 0 }, // green (grass)
	0x33: { r: 51, g: 102, b: 153 }, // light blue (water)
	0x56: { r: 102, g: 102, b: 102 }, // dark gray (rock/mountain)
	0x72: { r: 153, g: 51, b: 0 }, // dark brown (earth/stalagmite)
	0x79: { r: 153, g: 102, b: 51 }, // brown (earth)
	0x81: { r: 153, g: 153, b: 153 }, // gray (stone tile/cobbled pavement)
	0x8C: { r: 153, g: 255, b: 102 }, // light green (light spot in grassy area)
	0xB3: { r: 204, g: 255, b: 255 }, // light blue (ice)
	0xBA: { r: 255, g: 51, b: 0 }, // red (wall)
	0xC0: { r: 255, g: 102, b: 0 }, // orange (lava)
	0xCF: { r: 255, g: 204, b: 153 }, // beige (sand)
	0xD2: { r: 255, g: 255, b: 0 }, // yellow (ladder/stairs/hole/…)
	0xD7: { r: 255, g: 255, b: 255 } // white (snow)
};

const byColor = {};
Object.keys(byByte).forEach(function(key) {
	const byteValue = Number(key);
	const color = byByte[byteValue];
	const id = `${color.r},${color.g},${color.b}`;
	byColor[id] = byteValue;
});

const unexploredMapByte = 0x00;
const unexploredPathByte = 0xFA;
const nonWalkablePathByte = 0xFF;

module.exports = {
	'unexploredMapByte': unexploredMapByte,
	'unexploredMap': byByte[unexploredMapByte],
	'nonWalkablePathByte': nonWalkablePathByte,
	// The Tibia 11 client marks unwalkable paths as yellow.
	'nonWalkablePath': byByte[0xD2],
	'unexploredPath': { r: 0xFA, g: 0xFA, b: 0xFA },
	'unexploredPathByte': unexploredPathByte,
	'byByte': byByte,
	'byColor': byColor
};
