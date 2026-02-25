import React, { useRef, useState } from 'react';
import {
  Box,
  ToggleButton,
  ToggleButtonGroup,
  Slider,
  Tooltip,
  IconButton,
  Popover,
} from '@mui/material';
import GestureIcon from '@mui/icons-material/Gesture';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DownloadIcon from '@mui/icons-material/Download';
import type { Tool } from '../types/drawing';

const PRESET_COLORS = [
  '#000000', '#ffffff', '#ef5350', '#42a5f5',
  '#66bb6a', '#ffee58', '#ff9800', '#ab47bc',
];

interface ToolbarProps {
  tool: Tool;
  color: string;
  width: number;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onClear: () => void;
  onSave?: () => void;
  orientation?: 'horizontal' | 'vertical';
}

const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  color,
  width,
  onToolChange,
  onColorChange,
  onWidthChange,
  onClear,
  onSave,
  orientation = 'vertical',
}) => {
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const isVertical = orientation === 'vertical';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        alignItems: 'center',
        gap: 1,
        p: 1,
        bgcolor: 'background.paper',
        borderRadius: 2,
        boxShadow: 3,
      }}
    >
      {/* Tool selector */}
      <ToggleButtonGroup
        value={tool}
        exclusive
        orientation={orientation}
        onChange={(_, v) => v && onToolChange(v as Tool)}
        size="small"
      >
        <Tooltip title="筆刷" placement={isVertical ? 'right' : 'bottom'}>
          <ToggleButton value="pen"><GestureIcon /></ToggleButton>
        </Tooltip>
        <Tooltip title="線段橡皮擦" placement={isVertical ? 'right' : 'bottom'}>
          <ToggleButton value="eraser"><AutoFixHighIcon /></ToggleButton>
        </Tooltip>
        <Tooltip title="一般橡皮擦" placement={isVertical ? 'right' : 'bottom'}>
          <ToggleButton value="pixel_eraser"><CleaningServicesIcon /></ToggleButton>
        </Tooltip>
        <Tooltip title="直線" placement={isVertical ? 'right' : 'bottom'}>
          <ToggleButton value="line"><HorizontalRuleIcon /></ToggleButton>
        </Tooltip>
        <Tooltip title="矩形" placement={isVertical ? 'right' : 'bottom'}>
          <ToggleButton value="rect"><CropSquareIcon /></ToggleButton>
        </Tooltip>
        <Tooltip title="圈選移動" placement={isVertical ? 'right' : 'bottom'}>
          <ToggleButton value="select"><HighlightAltIcon /></ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>

      {/* Stroke width */}
      <Box sx={{ width: isVertical ? 36 : 100, px: isVertical ? 0 : 1, py: isVertical ? 1 : 0 }}>
        <Slider
          value={width}
          min={2}
          max={30}
          orientation={isVertical ? 'vertical' : 'horizontal'}
          sx={{ height: isVertical ? 80 : undefined }}
          onChange={(_, v) => onWidthChange(v as number)}
          valueLabelDisplay="auto"
        />
      </Box>

      {/* Color picker */}
      <Tooltip title="顏色" placement={isVertical ? 'right' : 'bottom'}>
        <Box
          onClick={(e) => setColorAnchor(e.currentTarget)}
          sx={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            bgcolor: color,
            border: '2px solid',
            borderColor: 'divider',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />
      </Tooltip>
      <Popover
        open={Boolean(colorAnchor)}
        anchorEl={colorAnchor}
        onClose={() => setColorAnchor(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
      >
        <Box sx={{ p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 120 }}>
          {PRESET_COLORS.map((c) => (
            <Box
              key={c}
              onClick={() => { onColorChange(c); setColorAnchor(null); }}
              sx={{
                width: 24, height: 24, borderRadius: '50%', bgcolor: c,
                border: c === color ? '2px solid #7C4DFF' : '1px solid rgba(255,255,255,0.2)',
                cursor: 'pointer',
              }}
            />
          ))}
          <Tooltip title="自訂顏色">
            <Box
              onClick={() => colorInputRef.current?.click()}
              sx={{
                width: 24, height: 24, borderRadius: '50%',
                background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                cursor: 'pointer', border: '1px solid rgba(255,255,255,0.2)',
              }}
            />
          </Tooltip>
          <input
            ref={colorInputRef}
            type="color"
            style={{ display: 'none' }}
            onChange={(e) => { onColorChange(e.target.value); setColorAnchor(null); }}
          />
        </Box>
      </Popover>

      {/* Clear */}
      <Tooltip title="清除畫布" placement={isVertical ? 'right' : 'bottom'}>
        <IconButton size="small" color="error" onClick={onClear}>
          <DeleteForeverIcon />
        </IconButton>
      </Tooltip>

      {/* Save / Download */}
      {onSave && (
        <Tooltip title="儲存畫布" placement={isVertical ? 'right' : 'bottom'}>
          <IconButton size="small" color="primary" onClick={onSave}>
            <DownloadIcon />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

export default Toolbar;
