import React, { useState } from 'react';
import {
  Box,
  Button,
  Container,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Stack,
} from '@mui/material';
import BrushIcon from '@mui/icons-material/Brush';
import GroupIcon from '@mui/icons-material/Group';

const LandingPage: React.FC = () => {
  const [joinOpen, setJoinOpen] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [error, setError] = useState('');

  const handleHost = () => {
    const params = new URLSearchParams({ role: 'host' });
    window.location.search = params.toString();
  };

  const handleJoin = () => {
    const id = roomInput.trim().toUpperCase();
    if (!id) { setError('請輸入 Room ID'); return; }
    const params = new URLSearchParams({ role: 'client', room: id });
    window.location.search = params.toString();
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a0533 0%, #0d1b4b 100%)',
      }}
    >
      <Container maxWidth="xs">
        <Stack spacing={4} alignItems="center">
          <Box textAlign="center">
            <Typography variant="h3" fontWeight={800} color="primary" gutterBottom>
              ZeroCanvas
            </Typography>
            <Typography variant="body1" color="text.secondary">
              無後端 P2P 電子白板 · 平板手寫即時同步到電腦投影
            </Typography>
          </Box>

          <Stack spacing={2} width="100%">
            <Button
              variant="contained"
              size="large"
              startIcon={<BrushIcon />}
              onClick={handleHost}
              fullWidth
              sx={{ py: 1.8, fontSize: '1.1rem' }}
            >
              建立白板（投影端）
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<GroupIcon />}
              onClick={() => setJoinOpen(true)}
              fullWidth
              sx={{ py: 1.8, fontSize: '1.1rem' }}
            >
              加入白板（繪圖端）
            </Button>
          </Stack>

          <Typography variant="caption" color="text.disabled" textAlign="center">
            免伺服器 · 點對點加密傳輸 · 支援多人連線
          </Typography>
        </Stack>
      </Container>

      <Dialog open={joinOpen} onClose={() => setJoinOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>加入白板</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Room ID"
            placeholder="輸入 6 碼 Room ID（如：AB12CD）"
            value={roomInput}
            onChange={(e) => { setRoomInput(e.target.value.toUpperCase()); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            error={!!error}
            helperText={error || '掃描 QR Code 可自動填入'}
            inputProps={{ maxLength: 10 }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJoinOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleJoin}>加入</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LandingPage;
