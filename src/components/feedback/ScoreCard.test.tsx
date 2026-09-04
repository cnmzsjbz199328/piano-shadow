import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreCard } from './ScoreCard';
import { NoteResultList } from './NoteResultList';
import type { MatchCounts, NoteMatchResult, ScoreBreakdown } from '@/practice-engine';
import { note } from '@/test/factories';

const scores: ScoreBreakdown = { pitch: 96, timing: 78, rhythm: 91, duration: 84, completeness: 100, overall: 90 };
const counts: MatchCounts = { expected: 5, actual: 5, correct: 4, wrongNote: 1, missed: 0, extra: 0 };

describe('ScoreCard', () => {
  it('renders every category score and the note counts', () => {
    render(<ScoreCard scores={scores} counts={counts} />);
    expect(screen.getByText('90')).toBeInTheDocument(); // overall
    expect(screen.getByText('78')).toBeInTheDocument(); // timing
    expect(screen.getByText(/4 correct/)).toBeInTheDocument();
    expect(screen.getByText(/1 wrong note/)).toBeInTheDocument();
  });
});

describe('NoteResultList', () => {
  it('labels a wrong-note row with its signed semitone error, never inventing pitches', () => {
    const matches: NoteMatchResult[] = [
      {
        expectedIndex: 0,
        actualIndex: 0,
        expected: note(64, 2),
        actual: note(65, 2),
        result: 'wrong-note',
        pitchErrorSemitones: 1,
        onsetErrorMs: 0,
        durationErrorMs: 0,
        pitchScore: 70,
        timingScore: 100,
        durationScore: 100,
      },
      { expectedIndex: 1, expected: note(67, 3), result: 'missed', pitchScore: 0, timingScore: 0, durationScore: 0 },
    ];
    render(<NoteResultList matches={matches} />);
    expect(screen.getByText('E4')).toBeInTheDocument();
    expect(screen.getByText('F4')).toBeInTheDocument();
    expect(screen.getByText(/Wrong note \(\+1 semitone\)/)).toBeInTheDocument();
    expect(screen.getByText('Missed')).toBeInTheDocument();
  });
});
