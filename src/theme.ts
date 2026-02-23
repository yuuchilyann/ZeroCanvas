import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7C4DFF' },
    secondary: { main: '#00E5FF' },
    background: {
      default: '#121212',
      paper: '#1E1E2E',
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600 },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: { textTransform: 'none' },
      },
    },
  },
});

export default theme;
