import { LabIcon } from '@jupyterlab/ui-components';

const tableGridSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
  <rect x="2" y="2" width="20" height="20" rx="2" ry="2"
        fill="none" stroke="var(--jp-icon-contrast-color0, #616161)" stroke-width="2"/>
  <line x1="2"  y1="8"  x2="22" y2="8"
        stroke="var(--jp-icon-contrast-color0, #616161)" stroke-width="1.5"/>
  <line x1="2"  y1="14" x2="22" y2="14"
        stroke="var(--jp-icon-contrast-color0, #616161)" stroke-width="1.5"/>
  <line x1="8"  y1="8"  x2="8"  y2="22"
        stroke="var(--jp-icon-contrast-color0, #616161)" stroke-width="1.5"/>
  <line x1="16" y1="8"  x2="16" y2="22"
        stroke="var(--jp-icon-contrast-color0, #616161)" stroke-width="1.5"/>
  <rect x="2" y="2" width="20" height="6" rx="1"
        fill="var(--jp-icon-contrast-color0, #616161)" opacity="0.15"/>
</svg>`;

export const dremioIcon = new LabIcon({
  name: 'jupyter-dremio:catalog',
  svgstr: tableGridSvgStr,
});
