import React, { useMemo } from 'react';
import L from 'leaflet';
import { Marker, Popup } from 'react-leaflet';

export default function NumberedMarker({ position, number, color = '#2563eb' }) {
  const icon = useMemo(() => L.divIcon({
    className: 'marker-number',
    html: `<span style="background:${color}">${number}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  }), [number, color]);
  return (
    <Marker position={position} icon={icon}>
      <Popup>Balise {number}</Popup>
    </Marker>
  );
}
