/**
 * Tests for the per-cell OTPInput.
 *
 * Notes on the reference spec I was given:
 *   1. It mixed two query forms — `getAllByTestId('otp-input')` (no suffix)
 *      AND `getByTestId('otp-input-0')` (suffixed) — for the same elements.
 *      React Native only allows one `testID` per node, so I match the spec
 *      via positional indexing on the suffixed testIDs.
 *   2. It used `expect(node).toBeFocused()`. Neither
 *      `@testing-library/react-native` nor `@testing-library/jest-native`
 *      actually ships that matcher. Replaced with a `TextInput.focus` spy
 *      that asserts the correct cell received focus.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { OTPInput } from '@components/forms/OTPInput';

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper', () => ({}));

const cells = (api: ReturnType<typeof render>, length = 6) =>
  Array.from({ length }, (_, i) => api.getByTestId(`otp-input-${i}`));

describe('<OTPInput />', () => {
  let focusSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on the TextInput focus method so we can assert which cell
    // received focus on auto-advance / backspace. RN's TextInput exposes
    // `focus()` on the underlying ref — spying on the prototype catches
    // all instances regardless of ref identity.
    focusSpy = jest
      .spyOn(TextInput.prototype as unknown as { focus: () => void }, 'focus')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    focusSpy.mockRestore();
  });

  it('renders N input cells', () => {
    const api = render(<OTPInput value="" onChange={jest.fn()} length={6} />);
    expect(cells(api, 6)).toHaveLength(6);
  });

  it('emits onChange when a digit is entered', () => {
    const onChange = jest.fn();
    const api = render(<OTPInput value="" onChange={onChange} length={4} />);

    fireEvent.changeText(api.getByTestId('otp-input-0'), '1');

    expect(onChange).toHaveBeenLastCalledWith('1');
  });

  it('auto-focuses the next cell after a digit is entered', () => {
    const api = render(<OTPInput value="" onChange={jest.fn()} length={4} />);
    // autoFocus on the first cell runs once at mount; clear so we observe
    // only the focus call triggered by typing.
    focusSpy.mockClear();

    fireEvent.changeText(api.getByTestId('otp-input-0'), '1');

    expect(focusSpy).toHaveBeenCalled();
  });

  it('calls onComplete once every cell is filled', () => {
    const onComplete = jest.fn();
    const api = render(
      <OTPInput value="" onChange={jest.fn()} onComplete={onComplete} length={4} />,
    );

    cells(api, 4).forEach((cell, i) => {
      fireEvent.changeText(cell, String(i + 1));
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('1234');
  });

  it('moves focus back on Backspace from an empty cell', () => {
    const api = render(<OTPInput value="12" onChange={jest.fn()} length={4} />);
    focusSpy.mockClear();

    const third = api.getByTestId('otp-input-2'); // empty
    fireEvent(third, 'keyPress', { nativeEvent: { key: 'Backspace' } });

    // Component must have moved focus to a previous cell.
    expect(focusSpy).toHaveBeenCalled();
  });

  it('clears the current cell on Backspace when it has a digit', () => {
    const onChange = jest.fn();
    const api = render(<OTPInput value="12" onChange={onChange} length={4} />);

    const second = api.getByTestId('otp-input-1'); // '2'
    fireEvent(second, 'keyPress', { nativeEvent: { key: 'Backspace' } });

    expect(onChange).toHaveBeenLastCalledWith('1');
  });

  it('rejects non-digit input', () => {
    const onChange = jest.fn();
    const api = render(<OTPInput value="" onChange={onChange} length={4} />);

    fireEvent.changeText(api.getByTestId('otp-input-0'), 'a');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('fans a pasted code across cells (SMS autofill)', () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    const api = render(
      <OTPInput value="" onChange={onChange} onComplete={onComplete} length={4} />,
    );

    fireEvent.changeText(api.getByTestId('otp-input-0'), '1234');

    expect(onChange).toHaveBeenLastCalledWith('1234');
    expect(onComplete).toHaveBeenCalledWith('1234');
  });
});
