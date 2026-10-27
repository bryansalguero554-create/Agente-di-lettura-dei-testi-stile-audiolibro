import { describe, it, expect } from 'vitest';
import { scoreVoice, cleanVoiceName } from '../src/engines/webspeech.js';

const v = (name, lang = 'it-IT') => ({ name, lang, voiceURI: name });

describe('scelta delle voci del dispositivo', () => {
  it('preferisce le voci neurali e premium', () => {
    const ranked = [
      v('Alice'), v('Google italiano'), v('Microsoft Isabella Online (Natural) - Italian (Italy)'),
      v('Federica (Premium)'), v('Luca (Enhanced)'), v('Microsoft Elsa - Italian (Italy)'),
    ].sort((a, b) => scoreVoice(b).score - scoreVoice(a).score).map((x) => x.name);
    expect(ranked[0]).toMatch(/Isabella/);
    expect(ranked[1]).toMatch(/Federica/);
    expect(ranked[2]).toMatch(/Luca/);
    expect(scoreVoice(v('Federica (Premium)')).badge).toBe('Premium');
  });

  it('scarta le voci "novità" di Apple', () => {
    expect(scoreVoice(v('Bad News')).score).toBeLessThan(scoreVoice(v('Alice')).score);
  });

  it('semplifica i nomi delle voci', () => {
    expect(cleanVoiceName('Microsoft Isabella Online (Natural) - Italian (Italy)')).toBe('Isabella');
    expect(cleanVoiceName('Federica (Premium)')).toBe('Federica');
    expect(cleanVoiceName('Google italiano')).toBe('Google italiano');
  });
});
