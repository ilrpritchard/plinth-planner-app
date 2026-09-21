// Tiny zero-dependency test runner for the units helper.
// Run with:  node test/units.test.js
import {
  mmToIn, inToMm, fmtIn, fmtFeetIn, parseLength, SPEC, MM_PER_INCH,
} from '../src/core/units.js';

let pass = 0, fail = 0;
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }
function eq(name, got, want) {
  const ok = (typeof want === 'number') ? approx(got, want) : got === want;
  if (ok) { pass++; }
  else { fail++; console.error(`✗ ${name}\n    got:  ${got}\n    want: ${want}`); }
}

// conversions are exact inverses
eq('mmToIn(25.4)', mmToIn(25.4), 1);
eq('inToMm(1)', inToMm(1), 25.4);
eq('roundtrip 22mm', inToMm(mmToIn(22)), 22);
eq('MM_PER_INCH', MM_PER_INCH, 25.4);

// spec constants
eq('panel ~0.866"', approx(SPEC.PANEL_IN, 0.86614, 1e-4), true);
eq('plinth ~4.528"', approx(SPEC.PLINTH_IN, 4.52756, 1e-4), true);
eq('shelf ~0.709"', approx(SPEC.SHELF_IN, 0.70866, 1e-4), true);
eq('three drawer faces', SPEC.DRAWER_FACES_IN.length, 3);

// formatting snaps to eighths
eq('fmtIn(28)', fmtIn(28), '28"');
eq('fmtIn(28.5)', fmtIn(28.5), '28½"');
eq('fmtIn(28.25)', fmtIn(28.25), '28¼"');
eq('fmtIn(28.75)', fmtIn(28.75), '28¾"');
eq('fmtIn(0.5)', fmtIn(0.5), '½"');
eq('fmtIn(0)', fmtIn(0), '0"');
eq('fmtIn(35.9)->35⅞', fmtIn(35.9), '35⅞"');   // nearest eighth
eq('fmtIn(35.97)->36', fmtIn(35.97), '36"');    // rounds up across the inch
eq('fmtIn(-3.5)', fmtIn(-3.5), '-3½"');

// feet/inches
eq('fmtFeetIn(96)', fmtFeetIn(96), `8' 0"`);
eq('fmtFeetIn(98.5)', fmtFeetIn(98.5), `8' 2½"`);
eq('fmtFeetIn(10)', fmtFeetIn(10), '10"');

// parsing accepts the formats a user might type
eq('parseLength(96)', parseLength(96), 96);
eq('parseLength("96")', parseLength('96'), 96);
eq('parseLength(\'96"\')', parseLength('96"'), 96);
eq("parseLength(\"8'\")", parseLength("8'"), 96);
eq("parseLength(\"8'6\\\"\")", parseLength(`8'6"`), 102);
eq("parseLength(\"8' 6 1/2\\\"\")", parseLength(`8' 6 1/2"`), 102.5);
eq('parseLength("28 1/2")', parseLength('28 1/2'), 28.5);
eq('parseLength("1/2")', parseLength('1/2'), 0.5);

// ---- what people really type into a size box (her catch 2026-09-21: 16 meant 16 INCHES) ----
{
  const { parseRoomLength } = await import('../src/core/units.js');
  const cases = [
    ['16', 192], ['8', 96], ['12.5', 150], ['150', 150], ['36', 36], ['35', 420],
    ["16'", 192], ["16' 6\"", 198], ["16'6", 198], ['16 ft', 192], ['16ft', 192], ['16 feet', 192], ['16ft 6in', 198], ['16 ft 6 in', 198], ['16 foot 6 inches', 198],
    ['16-6', 198], ['192"', 192], ['192 in', 192], ['192 inches', 192],
    ['16’', 192], ['16’ 6”', 198], ['16′ 6″', 198], ["12' 6 1/2\"", 150.5], ["16''", 16],
  ];
  for (const [input, want] of cases) eq(`parseRoomLength(${JSON.stringify(input)})`, parseRoomLength(input), want);
  eq('parseRoomLength("")', Number.isNaN(parseRoomLength('')), true);
  eq('parseRoomLength("abc")', Number.isNaN(parseRoomLength('abc')), true);
  // parseLength itself stays inches for a bare number: a window is 36, never 36 feet
  eq('parseLength("36") stays inches', parseLength('36'), 36);
  eq('parseLength curly quotes', parseLength('8’ 6”'), 102);
}

console.log(`\nunits.test.js — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
