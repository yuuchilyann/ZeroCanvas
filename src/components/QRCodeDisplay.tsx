import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Card, CardContent, Typography, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

interface QRCodeDisplayProps {
  url: string;
  roomId: string;
}

const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ url, roomId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 160,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    }
  }, [url]);

  const handleCopy = () => {
    navigator.clipboard.writeText(url).catch(() => {});
  };

  return (
    <Card sx={{ maxWidth: 200 }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <canvas ref={canvasRef} />
        <Typography variant="h6" fontWeight={700} letterSpacing={4}>
          {roomId}
        </Typography>
        <Tooltip title="複製連結">
          <IconButton size="small" onClick={handleCopy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography variant="caption" color="text.secondary" textAlign="center">
          平板掃描 QR Code 加入
        </Typography>
      </CardContent>
    </Card>
  );
};

export default QRCodeDisplay;
