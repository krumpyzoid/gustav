import { describe, it, expect } from 'vitest';
import { composeClaudeCommand, stripResumeContinueFlags } from '../claude-command';

describe('stripResumeContinueFlags', () => {
  it('returns empty string unchanged', () => {
    expect(stripResumeContinueFlags('')).toBe('');
  });

  it('preserves unrelated flags', () => {
    expect(stripResumeContinueFlags('--dangerously-skip-permissions')).toBe(
      '--dangerously-skip-permissions',
    );
  });

  it('strips --resume and its token', () => {
    expect(stripResumeContinueFlags('--resume abc')).toBe('');
  });

  it('strips --continue', () => {
    expect(stripResumeContinueFlags('--continue')).toBe('');
  });

  it('strips --resume + token while preserving the rest', () => {
    expect(stripResumeContinueFlags('--resume abc --foo bar')).toBe('--foo bar');
  });

  it('strips multiple resume/continue tokens', () => {
    expect(stripResumeContinueFlags('--foo --resume abc --bar --continue')).toBe('--foo --bar');
  });

  it('handles --resume with no token after', () => {
    expect(stripResumeContinueFlags('--resume')).toBe('');
  });

  it('collapses excess whitespace produced by stripping', () => {
    expect(stripResumeContinueFlags('--foo  --resume abc  --bar')).toBe('--foo --bar');
  });
});

describe('composeClaudeCommand', () => {
  it('returns bare claude when no id and no args', () => {
    expect(composeClaudeCommand({})).toBe('claude');
  });

  it('appends --resume <id> when claudeSessionId is set', () => {
    expect(composeClaudeCommand({ claudeSessionId: 'abc' })).toBe('claude --resume abc');
  });

  it('passes through args when no id', () => {
    expect(composeClaudeCommand({ args: '--dangerously-skip-permissions' })).toBe(
      'claude --dangerously-skip-permissions',
    );
  });

  it('appends --resume <id> after user args when both are present', () => {
    expect(
      composeClaudeCommand({
        args: '--dangerously-skip-permissions',
        claudeSessionId: 'abc',
      }),
    ).toBe('claude --dangerously-skip-permissions --resume abc');
  });

  it('strips user-supplied --resume when no id is tracked', () => {
    expect(composeClaudeCommand({ args: '--resume bogus' })).toBe('claude');
  });

  it('strips user-supplied --resume and replaces with tracked id', () => {
    expect(
      composeClaudeCommand({
        args: '--resume bogus --foo',
        claudeSessionId: 'abc',
      }),
    ).toBe('claude --foo --resume abc');
  });

  it('strips user-supplied --continue when no id is tracked', () => {
    expect(composeClaudeCommand({ args: '--continue' })).toBe('claude');
  });

  it('strips user-supplied --continue and replaces with --resume <id> when id is tracked', () => {
    expect(composeClaudeCommand({ args: '--continue', claudeSessionId: 'abc' })).toBe(
      'claude --resume abc',
    );
  });

  it('handles empty args string the same as no args', () => {
    expect(composeClaudeCommand({ args: '' })).toBe('claude');
    expect(composeClaudeCommand({ args: '   ' })).toBe('claude');
  });
});
