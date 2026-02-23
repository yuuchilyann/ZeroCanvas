import React from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme';
import LandingPage from './pages/LandingPage';
import HostPage from './pages/HostPage';
import ClientPage from './pages/ClientPage';

function App() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role');
  const room = params.get('room');

  let page: React.ReactNode;
  if (role === 'host') {
    page = <HostPage />;
  } else if (role === 'client' && room) {
    page = <ClientPage roomId={room} />;
  } else {
    page = <LandingPage />;
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {page}
    </ThemeProvider>
  );
}

export default App;

