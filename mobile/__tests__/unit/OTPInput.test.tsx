/**
 * Tests for the per-cell OTPInput.
 *
 * The user's reference test mixed two query forms — `getAllByTestId('otp-input')`
 * (no suffix) AND `getByTestId('otp-input-0')` (suffixed) — for the same
 * elements. React Native only allows one `testID` per node, so I match
 * the spec via positional indexing on the suffixed testIDs.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { OTPInput } from '@components/forms/OTPInput';

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

const cells = (api: ReturnType<typeof render>, length = 6) =>
  Array.from({ length }, (_, i) => api.getByTestId(`otp-input-${i}`));

describe('<OTPInput />', () => {
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

    fireEvent.changeText(api.getByTestId('otp-input-0'), '1');

    expect(api.getByTestId('otp-input-1')).toBeFocused();
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

    const third = api.getByTestId('otp-input-2'); // empty
    fireEvent(third, 'keyPress', { nativeEvent: { key: 'Backspace' } });

    expect(api.getByTestId('otp-input-1')).toBeFocused();
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
