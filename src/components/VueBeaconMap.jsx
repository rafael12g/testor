import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { createApp, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { fetchBeaconSnapshot } from '../sim/fakeBackendApi';

const VueMapRoot = defineComponent({
  name: 'VueMapRoot',
  props: {
    raceId: { type: [String, Number], required: true },
    checkpoints: { type: Array, default: () => [] },
    center: { type: Object, required: true },
    onMapClick: { type: Function, default: null },
    orgaLocation: { type: Object, default: null },
  },
  setup(props) {
    const hostRef = ref(null);
    let map = null;
    let tileLayer = null;
    let checkpointMarkers = [];
    let beaconMarkers = [];
    let startMarker = null;
    let orgaMarker = null;
    let pollId = null;

    const clearMarkers = (items) => {
      items.forEach(item => item.remove());
      items.length = 0;
    };

    const drawCheckpoints = () => {
      if (!map) return;
      clearMarkers(checkpointMarkers);

      if (startMarker) {
        startMarker.remove();
        startMarker = null;
      }

      startMarker = L.circleMarker([props.center.lat, props.center.lng], {
        radius: 7,
        color: '#0ea5e9',
        fillColor: '#0ea5e9',
        fillOpacity: 0.8,
      }).addTo(map).bindPopup('Départ');

      props.checkpoints.forEach((cp, idx) => {
        const marker = L.marker([cp.lat, cp.lng])
          .addTo(map)
          .bindPopup(`Balise ${idx + 1}<br/>${cp.lat.toFixed(5)}, ${cp.lng.toFixed(5)}`);
        checkpointMarkers.push(marker);
      });
    };

    const drawOrga = () => {
      if (!map) return;
      if (orgaMarker) {
        orgaMarker.remove();
        orgaMarker = null;
      }
      if (!props.orgaLocation) return;
      orgaMarker = L.marker([props.orgaLocation.lat, props.orgaLocation.lng])
        .addTo(map)
        .bindPopup(`Orga GPS live<br/>±${Math.round(props.orgaLocation.accuracy || 0)}m`);
    };

    const drawBeacons = async () => {
      if (!map) return;
      clearMarkers(beaconMarkers);
      const beacons = await fetchBeaconSnapshot(props.raceId);
      beacons.forEach(beacon => {
        const freshnessSec = Math.max(0, Math.round((Date.now() - beacon.updatedAt) / 1000));
        const marker = L.circleMarker([beacon.lat, beacon.lng], {
          radius: 7,
          color: '#ef4444',
          fillColor: '#ef4444',
          fillOpacity: 0.85,
          weight: 2,
        }).addTo(map).bindPopup(
          `<b>${beacon.teamName}</b><br/>Balise: ${beacon.teamCode}<br/>Vitesse: ${beacon.speedKmh.toFixed(1)} km/h<br/>Batterie: ${beacon.battery.toFixed(1)}%<br/>Précision: ±${Math.round(beacon.accuracy)}m<br/>Dernier ping: il y a ${freshnessSec}s`
        );
        beaconMarkers.push(marker);
      });
    };

    const resetView = () => {
      if (!map) return;
      map.setView([props.center.lat, props.center.lng], 13);
      drawCheckpoints();
      drawBeacons();
    };

    onMounted(() => {
      if (!hostRef.value) return;
      map = L.map(hostRef.value, {
        zoomControl: true,
      }).setView([props.center.lat, props.center.lng], 13);

      tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      drawCheckpoints();
      drawOrga();
      drawBeacons();

      map.on('click', event => {
        if (!props.onMapClick) return;
        props.onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng });
      });

      pollId = window.setInterval(drawBeacons, 1600);
    });

    watch(() => props.raceId, resetView);
    watch(() => props.checkpoints, drawCheckpoints, { deep: true });
    watch(() => props.orgaLocation, drawOrga, { deep: true });
    watch(() => props.center, () => {
      if (!map) return;
      map.panTo([props.center.lat, props.center.lng]);
    }, { deep: true });

    onBeforeUnmount(() => {
      if (pollId) window.clearInterval(pollId);
      clearMarkers(checkpointMarkers);
      clearMarkers(beaconMarkers);
      if (startMarker) startMarker.remove();
      if (orgaMarker) orgaMarker.remove();
      if (tileLayer) tileLayer.remove();
      if (map) map.remove();
      map = null;
    });

    return () => h('div', { class: 'vue-map-shell', ref: hostRef });
  },
});

export default function VueBeaconMap({ raceId, checkpoints, center, onMapClick, orgaLocation }) {
  const hostRef = useRef(null);
  const appRef = useRef(null);
  const stateRef = useRef(null);

  if (!stateRef.current) {
    stateRef.current = reactive({
      raceId,
      checkpoints,
      center,
      onMapClick,
      orgaLocation,
    });
  }

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const ProxyRoot = defineComponent({
      name: 'VueMapProxyRoot',
      setup() {
        return () => h(VueMapRoot, stateRef.current);
      },
    });

    appRef.current = createApp(ProxyRoot);
    appRef.current.mount(hostRef.current);

    return () => {
      if (appRef.current) {
        appRef.current.unmount();
        appRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    stateRef.current.raceId = raceId;
    stateRef.current.checkpoints = checkpoints;
    stateRef.current.center = center;
    stateRef.current.onMapClick = onMapClick;
    stateRef.current.orgaLocation = orgaLocation;
  }, [raceId, checkpoints, center, onMapClick, orgaLocation]);

  return <div className="vue-map-host" ref={hostRef} />;
}
