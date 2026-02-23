import React from 'react';
import { Chip } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import type { ConnectionState } from '../types/peer';

interface ConnectionStatusProps {
  state: ConnectionState;
  clientCount?: number;
}

const labels: Record<ConnectionState, string> = {
  idle: '待機',
  connecting: '連線中...',
  connected: '已連線',
  disconnected: '已斷線',
  error: '連線錯誤',
};

const colors: Record<ConnectionState, 'success' | 'warning' | 'error' | 'default'> = {
  idle: 'default',
  connecting: 'warning',
  connected: 'success',
  disconnected: 'warning',
  error: 'error',
};

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ state, clientCount }) => {
  const label =
    state === 'connected' && clientCount !== undefined
      ? `已連線 (${clientCount} 台裝置)`
      : labels[state];

  return (
    <Chip
      icon={<FiberManualRecordIcon sx={{ fontSize: 12 }} />}
      label={label}
      color={colors[state]}
      size="small"
      sx={{ fontWeight: 600 }}
    />
  );
};

export default ConnectionStatus;
