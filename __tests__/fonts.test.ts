import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { Fonts } from '@/constants/Colors';

/**
 * Guards the brand type system's wiring.
 *
 * A font family name is just a string on both sides: `Fonts.body` names a
 * family, and `useFonts` in app/_layout.tsx is what actually binds that name to
 * a .ttf. If the two drift — a token renamed, a face added to `Fonts` but never
 * registered, an asset deleted — nothing throws. React Native silently falls
 * back to the OS system font, so the app still builds, still typechecks, and
 * just quietly stops being branded. That's the failure this test exists to
 * catch, because nothing else in the toolchain can see it.
 *
 * _layout.tsx is read as TEXT, not imported: it's a React tree and pulling it
 * into the jest import graph would drag the whole provider chain with it.
 */

const REPO = resolve(__dirname, '..');
const LAYOUT = join(REPO, 'app', '_layout.tsx');

/** family name -> asset path, as registered with expo-font at startup. */
function registeredFamilies(): Map<string, string> {
  const src = readFileSync(LAYOUT, 'utf8');
  const block = /useFonts\(\{([\s\S]*?)\}\);/.exec(src);
  if (!block) throw new Error('Could not find the useFonts({...}) call in app/_layout.tsx');

  const families = new Map<string, string>();
  const entry = /(\w+):\s*require\("([^"]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(block[1])) !== null) families.set(m[1], m[2]);
  return families;
}

describe('brand font wiring', () => {
  const registered = registeredFamilies();

  it('registers at least one family', () => {
    expect(registered.size).toBeGreaterThan(0);
  });

  it.each(Object.entries(Fonts))(
    'Fonts.%s resolves to a registered family',
    (_token, family) => {
      expect([...registered.keys()]).toContain(family);
    },
  );

  it.each([...registered.entries()])(
    'family %s points at a font asset that exists on disk',
    (_family, assetPath) => {
      // require() paths in _layout.tsx are relative to app/.
      expect(existsSync(resolve(REPO, 'app', assetPath))).toBe(true);
    },
  );

  it('registers no font that no token references (dead startup cost)', () => {
    const used = new Set<string>(Object.values(Fonts));
    expect([...registered.keys()].filter((f) => !used.has(f))).toEqual([]);
  });
});
