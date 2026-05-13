import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Barlow app header', () => {
  render(<App />);
  expect(screen.getByText(/BARLOW/i)).toBeInTheDocument();
});
