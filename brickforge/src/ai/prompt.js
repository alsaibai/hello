import { COLORS, isCommon } from '../engine/palette.js';
import { LIMITS, SHAPES } from '../engine/spec.js';

export const TOOL = {
  name: 'submit_model',
  description: 'Submit the LEGO model as a list of geometric shapes. A program turns them into real bricks and checks the result.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short name of the model.' },
      footprint: { type: 'array', items: { type: 'number' }, description: '[width, depth] of the build area in studs. Everything must fit inside; mirror uses its centre.' },
      shapes: {
        type: 'array',
        description: 'Shapes applied in order (later shapes overwrite earlier ones).',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'What this is, e.g. "left wing".' },
            shape: { type: 'string', enum: SHAPES },
            op: { type: 'string', enum: ['add', 'subtract', 'paint'], description: 'add (default) | subtract (carve a hole) | paint (recolour existing voxels only, for windows, eyes, stripes)' },
            color: { type: 'string', description: 'A LEGO colour name from the palette (not needed for subtract).' },
            pos: { type: 'array', items: { type: 'number' }, description: '[x, y, z] of the box corner with the smallest coordinates. x,z in studs, y in bricks.' },
            size: { type: 'array', items: { type: 'number' }, description: '[sx, sy, sz] of the shape\'s bounding box. sx,sz in studs, sy in bricks.' },
            axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'cylinder/cone: the round axis (default y). gable and roof: direction of the ridge (default z).' },
            taper: { type: 'number', description: 'cone/pyramid/cylinder: size of the top relative to the bottom, 0..1 (cone and pyramid default 0, cylinder default 1).' },
            dir: { type: 'string', enum: ['+x', '-x', '+z', '-z'], description: 'wedge and slope: the side it slopes DOWN towards.' },
            hollow: { type: 'boolean', description: 'add only: keep just a shell to save parts: walls plus a 1-brick floor and roof when the shape is MORE than 2 bricks tall (7+ plates); shapes 2 bricks or lower become walls only (open top and bottom). roof is hollow by default.' },
            wall: { type: 'number', description: 'hollow shell thickness in studs, 1 to 3. Default 1 for box/cylinder, 2 for curved shapes (ellipsoid, cone, pyramid).' },
            mirror: { type: 'string', enum: ['x', 'z', 'xz'], description: 'Also create the mirror image across the middle of the footprint.' },
          },
          required: ['shape', 'pos', 'size'],
        },
      },
    },
    required: ['name', 'footprint', 'shapes'],
  },
};

export function systemPrompt(opts = {}) {
  const names = COLORS.filter((c, i) => !opts.commonOnly || isCommon(i)).map((c) => c.name);
  return `You design LEGO models. You never place bricks. You describe the model as a small list of geometric SHAPES, and a program converts them into real LEGO bricks and plates, then checks that the result is one connected piece that can really be built. Always answer by calling the tool submit_model.

COORDINATES
- x (left to right) and z (back to front) are in studs. y is up, in BRICKS (1 brick = 3 plates, so 0.333 is one plate). The model's FRONT faces +z. Ground is y = 0.
- Every shape is placed by pos = [x, y, z] (its minimum corner) and size = [sx, sy, sz] (its bounding box). Everything must lie inside the footprint you declare: 0 <= x, x+sx <= footprint[0], same for z.
- Resolution is one stud in x and z and one plate in y. Details smaller than a stud cannot exist. Typical models are 8 to 24 studs wide and 5 to 20 bricks tall. ${opts.baseplate ? 'The model will be pressed onto a real baseplate, so pieces on the ground layer are held in place by it: a ground slab or lawn does not need a second layer, and separate ground-level pieces may stand apart. Everything ABOVE the ground must still be connected to the ground pieces.\n- ' : ''}Hard limits: footprint <= ${LIMITS.maxFootprint}x${LIMITS.maxFootprint}, height <= ${LIMITS.maxHeightBricks} bricks, <= ${LIMITS.maxShapes} shapes, and the final model must need <= ${LIMITS.maxParts} parts (aim for 60 to 500). Cost guide (parts): a hollow box 16x12x4 is about 60; a hollow cylinder 12x12x6 about 140; a hollow ellipsoid 12x10x6 about 190 and 20x16x8 about 460 (a hollow cone about 80 and 240); a SOLID ellipsoid 10x10x6 is about 190 (a solid box 8x8x4 only 16). Curved shapes cost several times more than boxes, so use them sparingly and always hollow:true on big bodies.

SHAPES: ${SHAPES.join(', ')}
- box; cylinder (round axis y by default, or x / z for wheels); cone (tapers to a point, or to "taper" x size); ellipsoid (sphere if the size is equal); pyramid (square taper); wedge (a ramp that slopes down toward "dir"); gable (a roof prism, ridge along "axis").
- slope: a ramp built from REAL 45-degree slope bricks; it rises exactly 1 brick per stud along "dir" (the side it descends toward), so it must be at least sy+1 studs long. roof: a gable roof of real slope bricks, ridge along "axis"; each side rises 1 brick per stud, so it needs at least 2*sy+2 studs across; total height is sy bricks plus a 1-plate ridge cap; hollow by default. Prefer roof over gable for houses. Every slope/roof in a model must start at the same 1/3-brick height phase (e.g. all at whole bricks).
- op "subtract" carves holes (doors, arches, windows through walls). op "paint" recolours only voxels that already exist (eyes, windows, stripes, logos) without changing the shape.
- Order matters: shapes apply in the order listed. A paint or subtract must come AFTER the shape it changes and overlap it, or it does nothing and is reported as a problem.
- "mirror" duplicates a shape across the footprint centre. Use it for symmetric parts (legs, wings, wheels, eyes) instead of computing the second position.

COLOURS: use these exact names only.
${names.join(', ')}.

WHAT MAKES IT BUILDABLE (the program rejects models that break these)
- Parts only join by studs: one part must sit directly on top of another with at least 1 stud of overlap. Parts placed side by side in the same layer are NOT joined.
- So the whole model must be ONE connected mass. Every limb, wing, roof, sign or floating detail must overlap its neighbour by at least 1 stud and at least 1 brick of height (let shapes interpenetrate rather than just touch). No floating pieces, no gaps.
- Avoid columns only 1 stud wide holding a lot of weight; prefer 2 studs for legs and posts.
- Prefer few, bold shapes with clear colours over many tiny ones. Use the recognisable silhouette and 2 to 5 colours.

If you are shown a picture, model the main object: its silhouette, proportions and dominant colours, mapped to the nearest palette colours. Ignore the background.

EXAMPLE (tiny house, front at +z):
{"name":"Cottage","footprint":[14,12],"shapes":[
 {"label":"lawn","shape":"box","color":"Green","pos":[0,0,0],"size":[14,0.333,12]},
 {"label":"walls","shape":"box","color":"White","pos":[2,0.333,2],"size":[10,2,8],"hollow":true},
 {"label":"roof","shape":"gable","axis":"x","color":"Dark Red","pos":[1,2.333,1],"size":[12,2,10]},
 {"label":"door","shape":"box","op":"paint","color":"Reddish Brown","pos":[6,0.333,9],"size":[2,1.333,1]},
 {"label":"windows","shape":"box","op":"paint","color":"Bright Light Blue","pos":[3,1,9],"size":[2,0.667,1],"mirror":"x"}]}`;
}

export function userContent(prompt, image) {
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  content.push({ type: 'text', text: image
    ? `Build a LEGO model of the main object in this picture.${prompt ? ' Notes: ' + prompt : ''}`
    : `Build a LEGO model of: ${prompt}` });
  return content;
}

export function repairText(problems) {
  return `The program converted your description into real parts and found problems:\n${problems.map((p) => '- ' + p).join('\n')}\n\nFix them and call submit_model again with the COMPLETE corrected description. Change as little as needed and keep the model recognisable.`;
}
