// Ready-made builds. These are shape descriptions, exactly what the AI would submit,
// so they go through the same voxelise -> pack -> check pipeline.
export const PRESETS = [
  {
    id: 'cottage', title: 'Cottage', blurb: 'Hollow walls, gable roof, chimney',
    spec: {
      name: 'Cottage', footprint: [16, 14], shapes: [
        { label: 'lawn', shape: 'box', color: 'Green', pos: [0, 0, 0], size: [16, 0.667, 14] },
        { label: 'path', shape: 'box', color: 'Tan', pos: [7, 0.667, 11], size: [2, 0.333, 3] },
        { label: 'walls', shape: 'box', color: 'White', pos: [3, 0.667, 3], size: [10, 2, 8], hollow: true },
        { label: 'roof', shape: 'roof', axis: 'x', color: 'Dark Red', pos: [2, 2.667, 2], size: [12, 3, 10] },
        { label: 'chimney', shape: 'box', color: 'Dark Bluish Gray', pos: [11, 2.667, 5], size: [2, 3.667, 2] },
        { label: 'door', shape: 'box', op: 'paint', color: 'Reddish Brown', pos: [7, 0.667, 10], size: [2, 1.333, 1] },
        { label: 'front windows', shape: 'box', op: 'paint', color: 'Bright Light Blue', pos: [4.5, 1.333, 10], size: [2, 0.667, 1], mirror: 'x' },
        { label: 'side windows', shape: 'box', op: 'paint', color: 'Bright Light Blue', pos: [3, 1.333, 6], size: [1, 0.667, 2], mirror: 'x' },
      ],
    },
  },
  {
    id: 'barn', title: 'Barn & silo', blurb: 'Slope-brick roof, hollow walls, silo',
    spec: {
      name: 'Barn & silo', footprint: [20, 12], shapes: [
        { label: 'lawn', shape: 'box', color: 'Green', pos: [0, 0, 0], size: [20, 0.667, 12] },
        { label: 'walls', shape: 'box', color: 'Red', pos: [2, 0.667, 2], size: [12, 3, 8], hollow: true },
        { label: 'roof', shape: 'roof', axis: 'x', color: 'Dark Bluish Gray', pos: [1, 3.667, 1], size: [14, 3, 10] },
        { label: 'big door', shape: 'box', op: 'paint', color: 'White', pos: [6, 0.667, 9], size: [4, 2.333, 1] },
        { label: 'door frame', shape: 'box', op: 'paint', color: 'Dark Red', pos: [7.5, 0.667, 9], size: [1, 2.333, 1] },
        { label: 'windows', shape: 'box', op: 'paint', color: 'Bright Light Blue', pos: [3.5, 2, 9], size: [1, 0.667, 1], mirror: 'x' },
        { label: 'silo', shape: 'cylinder', color: 'Light Bluish Gray', pos: [15, 0.667, 4], size: [4, 6, 4], hollow: true },
        { label: 'silo cap', shape: 'cone', color: 'Dark Bluish Gray', pos: [15, 6.667, 4], size: [4, 1.667, 4] },
      ],
    },
  },
  {
    id: 'rocket', title: 'Rocket', blurb: 'Cone nose, striped body, four fins',
    spec: {
      name: 'Rocket', footprint: [12, 12], shapes: [
        { label: 'body', shape: 'cylinder', color: 'White', pos: [3, 0.333, 3], size: [6, 6, 6], hollow: true },
        { label: 'red band', shape: 'cylinder', color: 'Red', pos: [3, 2.333, 3], size: [6, 1, 6] },
        { label: 'nose', shape: 'cone', color: 'Red', pos: [3, 6.333, 3], size: [6, 3.667, 6], taper: 0.1 },
        { label: 'engine', shape: 'cylinder', color: 'Dark Bluish Gray', pos: [4, 0, 4], size: [4, 0.333, 4] },
        { label: 'window', shape: 'box', op: 'paint', color: 'Bright Light Blue', pos: [5, 4.333, 8], size: [2, 1, 1] },
        { label: 'fins x', shape: 'wedge', dir: '-x', color: 'Red', pos: [0, 0.333, 5], size: [4, 3, 2], mirror: 'x' },
        { label: 'fins z', shape: 'wedge', dir: '-z', color: 'Red', pos: [5, 0.333, 0], size: [2, 3, 4], mirror: 'z' },
      ],
    },
  },
  {
    id: 'duck', title: 'Rubber duck', blurb: 'Ellipsoids, wedge beak, eyes',
    spec: {
      name: 'Rubber duck', footprint: [10, 12], shapes: [
        { label: 'body', shape: 'ellipsoid', color: 'Yellow', pos: [1, 0, 1], size: [8, 3.667, 9] },
        { label: 'tail', shape: 'wedge', dir: '+z', color: 'Yellow', pos: [3, 1.667, 0], size: [4, 1.333, 3] },
        { label: 'head', shape: 'ellipsoid', color: 'Yellow', pos: [2.5, 2.667, 6], size: [5, 3.667, 5] },
        { label: 'beak', shape: 'wedge', dir: '+z', color: 'Orange', pos: [3.5, 3.667, 9.5], size: [3, 0.667, 2.5] },
        { label: 'wings', shape: 'ellipsoid', color: 'Bright Light Orange', pos: [0, 0.667, 3], size: [2, 1.667, 4.5], mirror: 'x' },
        { label: 'eyes', shape: 'box', op: 'paint', color: 'Black', pos: [3, 4.667, 8], size: [1, 0.667, 2], mirror: 'x' },
      ],
    },
  },
  {
    id: 'robot', title: 'Robot', blurb: 'Boxes, cylinders, mirrored limbs',
    spec: {
      name: 'Robot', footprint: [12, 8], shapes: [
        { label: 'feet', shape: 'box', color: 'Dark Bluish Gray', pos: [2, 0, 1], size: [3, 0.667, 5], mirror: 'x' },
        { label: 'legs', shape: 'box', color: 'Light Bluish Gray', pos: [2.5, 0.667, 2.5], size: [2, 2, 2], mirror: 'x' },
        { label: 'hips', shape: 'box', color: 'Dark Bluish Gray', pos: [2, 2.667, 2], size: [8, 0.667, 5] },
        { label: 'torso', shape: 'box', color: 'Blue', pos: [2, 3.333, 2], size: [8, 3.333, 5], hollow: true },
        { label: 'chest panel', shape: 'box', op: 'paint', color: 'Yellow', pos: [4, 4.667, 6], size: [4, 1.333, 1] },
        { label: 'arms', shape: 'box', color: 'Light Bluish Gray', pos: [0, 3.333, 2.5], size: [2, 3, 3], mirror: 'x' },
        { label: 'hands', shape: 'cylinder', color: 'Red', pos: [0, 2.667, 2.5], size: [2, 0.667, 3], mirror: 'x' },
        { label: 'shoulder pads', shape: 'box', color: 'Dark Bluish Gray', pos: [0, 6.333, 2.5], size: [4, 0.667, 3], mirror: 'x' },
        { label: 'neck', shape: 'cylinder', color: 'Dark Bluish Gray', pos: [5, 6.667, 3], size: [2, 0.667, 2] },
        { label: 'head', shape: 'box', color: 'Light Bluish Gray', pos: [3.5, 7.333, 2], size: [5, 2, 4] },
        { label: 'eyes', shape: 'box', op: 'paint', color: 'Red', pos: [4, 8.333, 5], size: [1, 0.667, 1], mirror: 'x' },
        { label: 'antenna', shape: 'cylinder', color: 'Yellow', pos: [5, 9.333, 3], size: [2, 1.333, 2] },
      ],
    },
  },
  {
    id: 'racer', title: 'Race car', blurb: 'Wedge nose, cabin, cylinder wheels',
    spec: {
      name: 'Race car', footprint: [10, 18], shapes: [
        { label: 'chassis', shape: 'box', color: 'Red', pos: [1, 0.667, 1], size: [8, 1, 16] },
        { label: 'floor', shape: 'box', color: 'Dark Bluish Gray', pos: [1, 0.333, 1], size: [8, 0.333, 16] },
        { label: 'bonnet', shape: 'slope', dir: '+z', color: 'Red', pos: [2, 1.667, 12], size: [6, 1, 4] },
        { label: 'cabin', shape: 'box', color: 'Red', pos: [2, 1.667, 4], size: [6, 1, 7] },
        { label: 'windscreen', shape: 'wedge', dir: '+z', color: 'Bright Light Blue', pos: [2, 2.667, 8], size: [6, 1, 3] },
        { label: 'roof', shape: 'box', color: 'Red', pos: [2, 2.667, 3], size: [6, 1, 5] },
        { label: 'stripe', shape: 'box', op: 'paint', color: 'White', pos: [4, 1.667, 1], size: [2, 2, 16] },
        { label: 'wing posts', shape: 'box', color: 'Black', pos: [2, 1.667, 0.5], size: [1, 0.667, 1.5], mirror: 'x' },
        { label: 'rear wing', shape: 'box', color: 'Black', pos: [1, 2.333, 0], size: [8, 0.333, 2] },
        { label: 'front wheels', shape: 'cylinder', axis: 'x', color: 'Black', pos: [0, 0, 11], size: [3, 1.333, 3], mirror: 'x' },
        { label: 'rear wheels', shape: 'cylinder', axis: 'x', color: 'Black', pos: [0, 0, 2], size: [3, 1.333, 3], mirror: 'x' },
        { label: 'hubs', shape: 'box', op: 'paint', color: 'Light Bluish Gray', pos: [0, 0.333, 12], size: [1, 0.667, 1], mirror: 'x' },
      ],
    },
  },
  {
    id: 'pine', title: 'Pine tree', blurb: 'Stacked cones on a trunk',
    spec: {
      name: 'Pine tree', footprint: [12, 12], shapes: [
        { label: 'ground', shape: 'cylinder', color: 'Dark Tan', pos: [0, 0, 0], size: [12, 0.667, 12] },
        { label: 'trunk', shape: 'box', color: 'Reddish Brown', pos: [5, 0.667, 5], size: [2, 2, 2] },
        { label: 'bottom skirt', shape: 'cylinder', color: 'Dark Green', pos: [1, 1.667, 1], size: [10, 0.333, 10] },
        { label: 'bottom tier', shape: 'cone', color: 'Dark Green', pos: [1, 2, 1], size: [10, 2.667, 10], taper: 0.25 },
        { label: 'middle skirt', shape: 'cylinder', color: 'Green', pos: [2, 3.333, 2], size: [8, 0.333, 8] },
        { label: 'middle tier', shape: 'cone', color: 'Green', pos: [2, 3.667, 2], size: [8, 2.667, 8], taper: 0.25 },
        { label: 'top tier', shape: 'cone', color: 'Dark Green', pos: [3, 5.333, 3], size: [6, 2.667, 6], taper: 0.15 },
        { label: 'star', shape: 'cone', color: 'Bright Light Yellow', pos: [4.5, 7.667, 4.5], size: [3, 1.333, 3] },
      ],
    },
  },
  {
    id: 'mushroom', title: 'Toadstool', blurb: 'Hollow dome cap with painted spots',
    spec: {
      name: 'Toadstool', footprint: [14, 14], shapes: [
        { label: 'cap', shape: 'ellipsoid', color: 'Red', pos: [0, 2, 0], size: [14, 8, 14], hollow: true },
        { label: 'cut cap in half', shape: 'box', op: 'subtract', pos: [0, 2, 0], size: [14, 4, 14] },
        { label: 'stem', shape: 'cylinder', color: 'Tan', pos: [4.5, 0, 4.5], size: [5, 9.333, 5] },
        { label: 'spots', shape: 'ellipsoid', op: 'paint', color: 'White', pos: [2, 8, 3], size: [3, 2, 3], mirror: 'xz' },
      ],
    },
  },
];
