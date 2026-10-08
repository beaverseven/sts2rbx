// Music tracks for Gloomfen Rumble. All melodies and arrangements are original.
//
// Notation (compiled by sequencer.js compileTrack):
//   track: { name, bpm, beats (per bar), sub (steps per beat), swing (0..1, triplet feel at 1), verb (reverb
//            send scale), gain (track output level),
//            parts: { partName: { inst, gain, send (reverb), gate, vel, tight } },
//            sections: { S: { chords, play: { partName: spec }, from? } }, intro?: [S...], form: [S...] }
//   chords: one symbol per bar ('Gm7', 'F/C', 'A7'); 'A7,D7' splits a bar evenly; '%' repeats.
//   part specs (per section):
//     notes: 'A4:3 Bb4:1 | C5:4 -:2'   NOTE:steps ('-' = rest, duration sticks until changed,
//                                       '!' accent, '?' soft); '|' marks bars and is checked.
//     pat:   bass line over the chords, one char per step: R root (slash bass) 3 5 6 7 O(octave)
//            L(fifth below) b(flat 2nd) 4  A(approach to the next bar's root)  - hold  . rest
//     chord: stabs/pads voiced around `center`: X accent, x, o soft, - hold, . rest
//     arp:   arpeggio from `lo`: 1 3 5 7 8(octave) 9(octave third) 0(octave fifth), - hold, . rest
//     drums: { lane: 'x.o.X...' } lanes k kick, s snare, b brush, h hat, z shaker, w/W woodblock,
//            f frog, d water drop, p tin pot, t boom (patterns may span several bars)
//   common: vel, tr (transpose semitones), inst (override). A section with `from` inherits the
//   other section's chords and parts; listed parts replace, `null` removes.

export const TRACKS = {};
const def = (t) => { TRACKS[t.name] = t; return t; };

// ---------------------------------------------------------------------------
// TITLE: whimsical waltz in F, 3/4. Clarinet tune, accordion "pah-pah", tuba on the downbeat,
// music-box bells take the minor middle section.
def({
  name: 'title', bpm: 144, beats: 3, sub: 2, swing: 0, verb: 1.1,
  parts: {
    lead: { inst: 'clarinet', gain: 0.7, send: 0.22 },
    bell: { inst: 'glock', gain: 1.19, send: 0.35 },
    harp: { inst: 'harp', gain: 0.71, send: 0.3 },
    bass: { inst: 'tuba', gain: 0.36, send: 0.04 },
    chords: { inst: 'accordion', gain: 0.53, send: 0.12, gate: 0.8 },
    drums: { gain: 1.07, send: 0.08 },
  },
  sections: {
    A: {
      chords: 'F F Bb F Gm7 C7 F C7',
      play: {
        lead: { notes: 'A4:3 Bb4:1 A4:2 | C5:4 A4:2 | D5:3 C5:1 Bb4:2 | A4:4 F4:2 | G4:2 A4:2 Bb4:2 | C5:2 E5:2 G5:2 | F5:3 E5:1 D5:2 | C5:6' },
        bass: { pat: 'R-.... L-....', lo: 41 },
        chords: { chord: '..x.x.', center: 64, vel: 0.7 },
        drums: { k: 'o.....', w: '..o.o.' },
      },
    },
    A2: {
      from: 'A',
      chords: 'F F Bb Bbm F/C C7 F C7',
      play: {
        lead: { notes: 'A4:3 Bb4:1 A4:2 | C5:4 A4:2 | D5:3 E5:1 F5:2 | Db5:4 C5:2 | C5:2 A4:2 F4:2 | G4:2 Bb4:2 E4:2 | F4:6 | -:2 C5:1 D5:1 E5:2' },
        harp: { arp: '1.5.8. 9.8.5.', lo: 53, vel: 0.7 },
      },
    },
    B: {
      chords: 'Dm Dm/C Bb A7 Gm C7 F C7',
      play: {
        bell: { notes: 'F5:1 -:1 E5:1 -:1 D5:2 | A4:2 D5:2 F5:2 | G5:1 -:1 F5:1 -:1 D5:2 | C#5:4 E5:2 | Bb5:3 A5:1 G5:2 | E5:2 G5:2 Bb5:2 | A5:3 G5:1 F5:2 | E5:2 D5:2 C5:2' },
        lead: { notes: 'D4:6 | C4:6 | D4:6 | E4:6 | D4:6 | E4:6 | F4:6 | G4:6', vel: 0.5 },
        harp: { arp: '1.3.5.', lo: 50, vel: 0.6 },
        bass: { pat: 'R-.... L-....', lo: 38 },
        chords: { chord: '..o.o.', center: 62, vel: 0.6 },
        drums: { k: 'o.....', w: '..o.o.', b: '..o.o.' },
      },
    },
    A3: {
      from: 'A',
      chords: 'F F Bb Bbm F/C C7 F C7',
      play: {
        lead: { notes: 'A4:3 Bb4:1 A4:2 | C5:4 A4:2 | D5:3 C5:1 Bb4:2 | Db5:3 C5:1 Bb4:2 | A4:2 C5:2 F5:2 | E5:2 G5:2 E5:2 | F5:6 | -:2 G4:2 Bb4:2' },
        bell: { notes: 'A4:3 Bb4:1 A4:2 | C5:4 A4:2 | D5:3 C5:1 Bb4:2 | Db5:3 C5:1 Bb4:2 | A4:2 C5:2 F5:2 | E5:2 G5:2 E5:2 | F5:6 | -:6', tr: 12, vel: 0.4 },
        harp: { arp: '1.5.8. 9.8.5.', lo: 53, vel: 0.6 },
      },
    },
  },
  form: ['A', 'A2', 'B', 'A3'],
});

// ---------------------------------------------------------------------------
// GLADE: bouncy swing in G, 112 bpm. Marimba tune, banjo rolls, two-feel tuba, brushes.
// Bridge on clarinet with a walking bass.
def({
  name: 'glade', bpm: 112, beats: 4, sub: 2, swing: 0.55, verb: 0.9, gain: 0.86,
  parts: {
    lead: { inst: 'marimba', gain: 1.35, send: 0.18 },
    lead2: { inst: 'clarinet', gain: 1.07, send: 0.2 },
    banjo: { inst: 'banjo', gain: 0.81, send: 0.1 },
    bass: { inst: 'tuba', gain: 0.29, send: 0.03, gate: 0.85 },
    chords: { inst: 'accordion', gain: 0.71, send: 0.08, gate: 0.6 },
    drums: { gain: 0.74, send: 0.06 },
  },
  sections: {
    A: {
      chords: 'G G C G Em A7 D7 D7',
      play: {
        lead: { notes: 'B4:1 D5:1 G5:2 F#5:1 G5:1 A5:2 | B5:3 A5:1 G5:2 -:2 | E5:1 G5:1 C6:2 B5:1 A5:1 G5:2 | D5:4 -:2 B4:1 C5:1 | D5:1 E5:1 G5:2 E5:2 B4:2 | C#5:2 E5:2 G5:2 E5:2 | F#5:3 E5:1 D5:2 C5:2 | A4:2 B4:1 C5:1 D5:2 -:2' },
        banjo: { arp: '15853585', lo: 55, vel: 0.62 },
        bass: { pat: 'R-..5-.. R-..5-A-', lo: 40 },
        chords: { chord: '..o...o.', center: 64, vel: 0.6 },
        drums: { k: 'x...x...', b: '..x...x.', z: '.o.o.o.o' },
      },
    },
    A2: {
      from: 'A',
      chords: 'G G C Cm G/D E7 A7,D7 G',
      play: {
        lead: { notes: 'B4:1 D5:1 G5:2 F#5:1 G5:1 A5:2 | B5:3 A5:1 G5:2 -:2 | E5:1 G5:1 C6:2 B5:1 A5:1 G5:2 | Eb5:2 G5:2 Eb5:2 C5:2 | B4:1 C5:1 D5:2 G5:2 B4:2 | G#4:2 B4:2 D5:2 E5:2 | E5:2 C#5:2 D5:2 C5:2 | B4:4 -:4' },
        lead2: { notes: 'G4:8 | F#4:8 | E4:8 | Eb4:8 | D4:8 | D4:8 | C#4:4 C4:4 | B3:8', vel: 0.45 },
      },
    },
    B: {
      chords: 'C C G G Am D7 G,E7 A7,D7',
      play: {
        lead2: { notes: 'G5:3 E5:1 C5:4 | -:2 E5:1 F5:1 G5:2 A5:2 | B5:3 G5:1 D5:4 | -:2 D5:1 E5:1 F#5:2 G5:2 | A5:3 G5:1 E5:2 C5:2 | D5:2 F#5:2 A5:2 C6:2 | B5:2 G5:2 G#5:2 E5:2 | A5:2 E5:2 F#5:2 D5:2', tr: -12, vel: 0.85 },
        banjo: { arp: '1.5.8.5.', lo: 55, vel: 0.55 },
        bass: { pat: 'R-3-5-A-', lo: 40 },
        chords: { chord: '..o...o.', center: 64, vel: 0.55 },
        drums: { k: 'x.......', b: '..x...x.', z: '.o.o.o.o', w: '......o. ........' },
      },
    },
    A3: {
      from: 'A2',
      play: {
        lead: { notes: 'B4:1 D5:1 G5:2 F#5:1 G5:1 A5:2 | B5:3 A5:1 G5:2 -:2 | E5:1 G5:1 C6:2 B5:1 A5:1 G5:2 | Eb5:2 G5:2 Eb5:2 C5:2 | B4:1 C5:1 D5:2 G5:2 B4:2 | G#4:1 A4:1 B4:2 D5:2 E5:2 | E5:2 C#5:2 D5:2 F#5:2 | G5:2 -:6' },
      },
    },
  },
  form: ['A', 'A2', 'B', 'A3'],
});

// ---------------------------------------------------------------------------
// BOG: murky D minor, 84 bpm. Low clarinet, dark accordion pad, kalimba water plinks,
// frog croaks and droplets for percussion.
def({
  name: 'bog', bpm: 84, beats: 4, sub: 4, swing: 0, verb: 1.35,
  parts: {
    lead: { inst: 'clarinet', gain: 0.72, send: 0.32 },
    kal: { inst: 'kalimba', gain: 1.19, send: 0.45 },
    pad: { inst: 'accordion', gain: 0.4, send: 0.3, gate: 0.98 },
    bass: { inst: 'tuba', gain: 0.28, send: 0.08 },
    harp: { inst: 'harp', gain: 0.94, send: 0.4 },
    drums: { gain: 1.43, send: 0.25 },
  },
  sections: {
    A: {
      chords: 'Dm Dm Bb C Dm Dm Gm A7',
      play: {
        lead: { notes: '-:4 A4:4 D5:6 E5:2 | F5:6 E5:2 D5:4 -:4 | -:4 F5:4 D5:4 Bb4:4 | C5:6 D5:2 E5:4 C5:4 | D5:12 -:4 | -:4 F5:2 G5:2 A5:6 G5:2 | F5:4 D5:4 Bb4:4 G4:4 | A4:12 -:4', tr: -12 },
        pad: { chord: 'x---------------', center: 57, vel: 0.5 },
        bass: { pat: 'R-------....5---', lo: 38 },
        kal: { arp: '....8.......5... ........9.....0.', lo: 62, vel: 0.55 },
        drums: { k: 'o.......o.......', f: '..........x.x... ..x.............', d: '......x......... .............x..', z: '..o...o...o...o.' },
      },
    },
    B: {
      chords: 'Bb F Gm Dm Bb F/A Gm A7',
      play: {
        lead: { notes: 'D5:6 C5:2 Bb4:4 F4:4 | C5:6 A4:2 F4:8 | G4:4 Bb4:4 D5:4 F5:4 | E5:6 D5:2 A4:8 | D5:4 F5:4 Bb5:6 A5:2 | A5:4 G5:2 F5:2 C5:8 | Bb4:4 D5:4 G5:4 F5:2 E5:2 | C#5:8 E5:4 A4:4', vel: 0.7 },
        harp: { arp: '1...5...8...5...', lo: 50, vel: 0.6 },
        pad: { chord: 'x-------x-------', center: 57, vel: 0.45 },
        bass: { pat: 'R-------5-------', lo: 38 },
        kal: null,
        drums: { k: 'o.......o.......', f: '......x.....x... ..x.......x.x...', d: '...x............ .........x......', z: '..o...o...o...o.' },
      },
    },
    A2: {
      from: 'A',
      play: {
        kal: { notes: '-:4 A4:4 D5:6 E5:2 | F5:6 E5:2 D5:4 -:4 | -:4 F5:4 D5:4 Bb4:4 | C5:6 D5:2 E5:4 C5:4 | D5:12 -:4 | -:4 F5:2 G5:2 A5:6 G5:2 | F5:4 D5:4 Bb4:4 G4:4 | A4:12 -:4', vel: 0.5 },
        harp: { arp: '....8.......5... ........9.....0.', lo: 50, vel: 0.5 },
      },
    },
    B2: {
      from: 'B',
      play: {
        lead: { notes: 'D5:6 C5:2 Bb4:4 F4:4 | C5:6 A4:2 F4:8 | G4:4 Bb4:4 D5:4 F5:4 | E5:6 D5:2 A4:8 | D5:4 F5:4 Bb5:6 A5:2 | A5:4 G5:2 F5:2 C5:8 | Bb4:4 D5:4 G5:4 F5:2 E5:2 | C#5:8 E5:4 A4:4', tr: -12 },
        kal: { notes: 'D5:6 C5:2 Bb4:4 F4:4 | C5:6 A4:2 F4:8 | G4:4 Bb4:4 D5:4 F5:4 | E5:6 D5:2 A4:8 | D5:4 F5:4 Bb5:6 A5:2 | A5:4 G5:2 F5:2 C5:8 | Bb4:4 D5:4 G5:4 F5:2 E5:2 | C#5:8 E5:4 A4:4', vel: 0.42 },
      },
    },
  },
  form: ['A', 'B', 'A2', 'B2'],
});

// ---------------------------------------------------------------------------
// FORT: comic bandit march in G minor, 112 bpm. Staccato clarinet, oom-pah tuba, accordion
// off-beats, marching snare with a tin-pot backbeat; the tuba struts the tune in the bridge.
def({
  name: 'fort', bpm: 112, beats: 4, sub: 4, swing: 0, verb: 0.85,
  parts: {
    lead: { inst: 'clarinet', gain: 0.79, send: 0.14, gate: 0.85 },
    lead2: { inst: 'marimba', gain: 1.35, send: 0.14 },
    tuba: { inst: 'tuba', gain: 0.28, send: 0.05, gate: 0.85 },
    bass: { inst: 'tuba', gain: 0.37, send: 0.03, gate: 0.8 },
    chords: { inst: 'accordion', gain: 0.56, send: 0.08, gate: 0.7 },
    drums: { gain: 0.9, send: 0.08, tight: true },
  },
  sections: {
    A: {
      chords: 'Gm Gm D7 Gm Cm Gm D7 Gm',
      play: {
        lead: { notes: 'G4:2 -:2 G4:2 -:2 Bb4:2 -:2 D5:4 | Eb5:2 D5:2 C#5:2 D5:2 -:4 Bb4:4 | A4:2 -:2 A4:2 -:2 C5:2 -:2 F#5:4 | G5:4 D5:4 Bb4:4 G4:4 | C5:2 -:2 Eb5:2 -:2 G5:2 -:2 Eb5:4 | D5:2 -:2 Bb4:2 -:2 G4:4 Bb4:4 | A4:2 Bb4:2 C5:2 D5:2 Eb5:2 D5:2 C5:2 A4:2 | G4:4 -:4 D4:4 -:4' },
        bass: { pat: 'R-......5-......', lo: 38 },
        chords: { chord: '....x-......x-..', center: 62, vel: 0.65 },
        drums: {
          k: 'x.......x.......', p: '....x.......x...',
          s: '..o...o...o.o.o. ..o...o...o.o.o. ..o...o...o.o.o. x.x.x.x.xoxoxoxo',
        },
      },
    },
    A2: {
      from: 'A',
      chords: 'Gm Gm Eb D7 Cm Gm/D D7 Gm',
      play: {
        lead: { notes: 'G4:2 -:2 G4:2 -:2 Bb4:2 -:2 D5:4 | Eb5:2 D5:2 C#5:2 D5:2 -:4 G5:4 | G5:2 -:2 F5:2 -:2 Eb5:2 -:2 Bb4:4 | A4:4 F#4:4 A4:4 C5:4 | Eb5:2 -:2 D5:2 -:2 C5:2 -:2 G4:4 | Bb4:4 D5:4 G5:4 F#5:2 F5:2 | Eb5:2 D5:2 C5:2 Bb4:2 A4:4 F#4:4 | G4:4 -:4 G3:2 -:2 -:4' },
        lead2: { notes: 'G4:2 -:2 G4:2 -:2 Bb4:2 -:2 D5:4 | Eb5:2 D5:2 C#5:2 D5:2 -:4 G5:4 | G5:2 -:2 F5:2 -:2 Eb5:2 -:2 Bb4:4 | A4:4 F#4:4 A4:4 C5:4 | Eb5:2 -:2 D5:2 -:2 C5:2 -:2 G4:4 | Bb4:4 D5:4 G5:4 F#5:2 F5:2 | Eb5:2 D5:2 C5:2 Bb4:2 A4:4 F#4:4 | G4:4 -:4 G3:2 -:2 -:4', tr: 12, vel: 0.45 },
      },
    },
    B: {
      chords: 'Bb F7 F7 Bb Eb Bb C7 F7',
      play: {
        tuba: { notes: 'Bb2:4 D3:4 F3:4 D3:4 | C3:4 Eb3:4 A2:4 F2:4 | F2:2 G2:2 A2:2 Bb2:2 C3:4 A2:4 | Bb2:8 -:4 F2:4 | Eb3:4 G3:4 Bb3:4 G3:4 | F3:4 D3:4 Bb2:4 D3:4 | E3:4 G3:4 C3:4 Bb2:4 | A2:4 C3:4 Eb3:4 F3:2 F#3:2', vel: 0.95 },
        lead: { notes: '-:12 F5:2 D5:2 | -:12 Eb5:2 C5:2 | -:16 | -:8 D5:2 F5:2 Bb5:4 | -:12 G5:2 Eb5:2 | -:12 F5:2 D5:2 | -:12 E5:2 G5:2 | -:8 C5:2 Eb5:2 F5:2 F#5:2', vel: 0.7 },
        bass: null,
        chords: { chord: '....x-......x-..', center: 63, vel: 0.6 },
        drums: { k: 'x.......x.......', p: '....x.......x...', s: '..o...o...o.o.o.', w: '.............o.o' },
      },
    },
    A3: {
      from: 'A',
      play: {
        lead2: { notes: 'G4:2 -:2 G4:2 -:2 Bb4:2 -:2 D5:4 | Eb5:2 D5:2 C#5:2 D5:2 -:4 Bb4:4 | A4:2 -:2 A4:2 -:2 C5:2 -:2 F#5:4 | G5:4 D5:4 Bb4:4 G4:4 | C5:2 -:2 Eb5:2 -:2 G5:2 -:2 Eb5:4 | D5:2 -:2 Bb4:2 -:2 G4:4 Bb4:4 | A4:2 Bb4:2 C5:2 D5:2 Eb5:2 D5:2 C5:2 A4:2 | G4:4 -:4 D4:4 -:4', tr: 12, vel: 0.5 },
      },
    },
  },
  form: ['A', 'A2', 'B', 'A3'],
});

// ---------------------------------------------------------------------------
// BOSS: fast and tense, E minor with a flat-2nd bite, 150 bpm. Driving tuba ostinato,
// syncopated accordion stabs, brassy horn melody, marimba sixteenths, boom drum.
def({
  name: 'boss', bpm: 150, beats: 4, sub: 4, swing: 0, verb: 0.8,
  parts: {
    lead: { inst: 'horn', gain: 0.61, send: 0.14 },
    lead2: { inst: 'clarinet', gain: 0.62, send: 0.14 },
    bass: { inst: 'tuba', gain: 0.25, send: 0.02, gate: 0.8, tight: true },
    stabs: { inst: 'accordion', gain: 0.75, send: 0.1, gate: 0.55 },
    arp: { inst: 'marimba', gain: 0.42, send: 0.1, tight: true },
    drums: { gain: 0.66, send: 0.06, tight: true },
  },
  sections: {
    A: {
      chords: 'Em Em C C Am Am B7 B7',
      play: {
        bass: { pat: 'R-R-O-R-3-R-b-R-', lo: 40 },
        stabs: { chord: 'X.....X.....X...', center: 62, vel: 0.75 },
        drums: { k: 'x...x...x...x...', s: '....X.......X...', h: 'o.x.o.x.o.x.o.x.', t: 'X............... ................' },
      },
    },
    B: {
      from: 'A',
      play: {
        lead: { notes: 'E5:6 F#5:2 G5:4 B5:4 | A5:4 G5:4 F#5:4 D5:4 | E5:6 G5:2 C6:4 B5:4 | G5:12 -:4 | A5:4 C6:4 B5:4 A5:4 | E5:8 C5:4 E5:4 | D#5:6 F#5:2 A5:4 B5:4 | F#5:8 D#5:4 B4:4', tr: -12 },
        arp: { arp: '1358', lo: 64, vel: 0.5 },
      },
    },
    C: {
      chords: 'C D Bm Em C D B7 B7',
      play: {
        lead2: { notes: 'G5:8 E5:8 | F#5:8 A5:8 | F#5:6 D5:2 B4:8 | E5:16 | G5:4 F#5:4 E5:4 C5:4 | D5:4 E5:4 F#5:4 A5:4 | B5:8 A5:4 F#5:4 | D#5:12 -:4', vel: 0.75 },
        bass: { pat: 'R-------R---O---', lo: 40 },
        stabs: { chord: 'x-------x-------', center: 64, vel: 0.5 },
        arp: { arp: '1.5.8.5.1.5.8.5.', lo: 64, vel: 0.45 },
        drums: {
          k: 'x.......x.......', t: 'X...............', h: '..o...o...o...o.',
          s: '................ ................ ................ ....x.x.xxxxXXXX',
        },
      },
    },
    B2: {
      from: 'B',
      play: {
        lead2: { notes: 'E5:6 F#5:2 G5:4 B5:4 | A5:4 G5:4 F#5:4 D5:4 | E5:6 G5:2 C6:4 B5:4 | G5:12 -:4 | A5:4 C6:4 B5:4 A5:4 | E5:8 C5:4 E5:4 | D#5:6 F#5:2 A5:4 B5:4 | F#5:8 D#5:4 B4:4', vel: 0.7 },
      },
    },
  },
  form: ['A', 'B', 'C', 'B2'],
});

// ---------------------------------------------------------------------------
// VICTORY: a short horn fanfare with a snare roll, then a gentle kalimba + harp loop in C.
def({
  name: 'victory', bpm: 100, beats: 4, sub: 4, swing: 0, verb: 1.15,
  parts: {
    lead: { inst: 'horn', gain: 0.58, send: 0.22 },
    kal: { inst: 'kalimba', gain: 1.36, send: 0.35 },
    harp: { inst: 'harp', gain: 0.76, send: 0.35 },
    pad: { inst: 'accordion', gain: 0.29, send: 0.25, gate: 0.97 },
    bass: { inst: 'tuba', gain: 0.25, send: 0.08 },
    bell: { inst: 'glock', gain: 0.78, send: 0.4 },
    drums: { gain: 0.63, send: 0.12, tight: true },
  },
  sections: {
    I: {
      chords: 'C F,G7 C',
      play: {
        lead: { notes: 'C5:2 -:1 C5:1 E5:2 -:1 G5:1 C6:6 -:2 | A5:2 -:2 F5:4 B5:2 -:2 G5:4 | C6:12 -:4', tr: -12, vel: 0.9 },
        bell: { notes: 'C5:2 -:1 C5:1 E5:2 -:1 G5:1 C6:6 -:2 | A5:2 -:2 F5:4 B5:2 -:2 G5:4 | C6:12 -:4', vel: 0.55 },
        bass: { notes: 'C3:2 -:1 C3:1 C3:2 -:1 C3:1 C3:6 -:2 | F2:4 -:4 G2:4 -:4 | C3:12 -:4' },
        pad: { chord: 'x-------x-------', center: 60, vel: 0.6 },
        drums: {
          s: 'o.o.o.o.o.o.o.o. oooooooooooooooo X...............',
          t: 'X............... X.......X....... X...............',
        },
      },
    },
    L: {
      chords: 'C Am F G C/E F Dm7 G7',
      play: {
        kal: { notes: 'E5:4 G5:4 C6:6 B5:2 | A5:8 E5:8 | F5:4 A5:4 C6:4 A5:4 | G5:12 -:4 | E5:4 D5:2 C5:2 G5:8 | A5:4 G5:2 F5:2 C5:8 | D5:4 F5:4 A5:4 C6:4 | B5:8 -:8' },
        harp: { arp: '1.5.8.9.0.9.8.5.', lo: 48, vel: 0.55 },
        pad: { chord: 'x---------------', center: 60, vel: 0.45 },
        bass: { pat: 'R-------5-------', lo: 36 },
        drums: { b: '....x.......x...', k: 'o.......o.......', z: '..o...o...o...o.' },
      },
    },
    L2: {
      from: 'L',
      chords: 'C Am F Fm C/G G7 C C',
      play: {
        kal: { notes: 'E5:4 G5:4 C6:6 D6:2 | E6:8 C6:8 | A5:4 C6:4 F6:4 C6:4 | Ab5:8 G5:4 F5:4 | E5:8 G5:8 | D5:4 F5:4 B5:4 D6:4 | C6:16 | -:16' },
        bell: { notes: 'E5:4 G5:4 C6:6 D6:2 | E6:8 C6:8 | A5:4 C6:4 F6:4 C6:4 | Ab5:8 G5:4 F5:4 | E5:8 G5:8 | D5:4 F5:4 B5:4 D6:4 | C6:16 | -:16', tr: -12, vel: 0.35 },
      },
    },
  },
  intro: ['I'],
  form: ['L', 'L2'],
});

export const TRACK_NAMES = Object.keys(TRACKS);
