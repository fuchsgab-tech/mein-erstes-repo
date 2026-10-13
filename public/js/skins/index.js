// Weitere Stile: jeder in einer eigenen Datei (js/skins/<id>.js + css/skins/<id>.css).
// Jede Datei exportiert `skin` (für die Stil-Auswahl) und optional `scene` (bewegter Hintergrund für js/bgfx.js).
import * as matrix from './matrix.js';
import * as arcade from './arcade.js';
import * as sakura from './sakura.js';
import * as comic from './comic.js';
import * as tiefsee from './tiefsee.js';
import * as glut from './glut.js';
import * as glas from './glas.js';
import * as lava from './lava.js';
import * as hochsee from './hochsee.js';

export const EXTRA_SKINS = [matrix, arcade, sakura, comic, tiefsee, glut, glas, lava, hochsee];
