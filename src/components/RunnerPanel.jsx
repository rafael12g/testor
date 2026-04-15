import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { CloudSun, Flag, Wind } from 'lucide-react';
import StatCard from './ui/StatCard';
import NumberedMarker from './ui/NumberedMarker';
import { DEFAULT_START } from '../utils/helpers';
import { fetchWeatherForecast } from '../api';

function weatherCodeToLabel(code) {
  const c = Number(code);
  if (c === 0) return 'Ensoleillé';
  if (c === 1) return 'Peu nuageux';
  if (c === 2) return 'Partiellement nuageux';
  if (c === 3) return 'Couvert';
  if (c === 45 || c === 48) return 'Brouillard';
  if ([51, 53, 55, 56, 57].includes(c)) return 'Bruine';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return 'Pluie';
  if ([71, 73, 75, 77, 85, 86].includes(c)) return 'Neige';
  if ([95, 96, 99].includes(c)) return 'Orage';
  return 'Conditions variables';
}

function formatHourLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDayLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export default function RunnerPanel({ runnerSession, races, runnerProgress, runnerLegProgress, permissions = {}, onValidate }) {
  const canSeeBalises = permissions.acces_balises_lecture !== false;
  const canSeeOrdreBalises = true;
  const canSeeCourses = permissions.acces_courses_lecture !== false;

  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [weatherData, setWeatherData] = useState(null);

  const race = useMemo(() => races.find(r => r.id === runnerSession?.raceId), [races, runnerSession]);
  const totalCheckpoints = runnerSession?.order?.length || 0;
  const nextIndex = runnerProgress;
  const start = race?.start || runnerSession?.start || DEFAULT_START;
  const nextCheckpoint = (runnerSession?.order || [])[nextIndex] || null;
  const isFinished = nextIndex >= totalCheckpoints;
  const currentLabel = totalCheckpoints === 0 ? 'Aucune balise' : (nextIndex === 0 ? 'Départ' : `Balise ${nextIndex}`);
  const nextLabel = totalCheckpoints === 0 ? '—' : (nextIndex >= totalCheckpoints ? 'Arrivée' : `Balise ${nextIndex + 1}`);

  useEffect(() => {
    let cancelled = false;

    const loadWeather = async () => {
      if (!start?.lat || !start?.lng) {
        setWeatherData(null);
        return;
      }
      setWeatherLoading(true);
      setWeatherError('');
      const data = await fetchWeatherForecast(start.lat, start.lng);
      if (cancelled) return;
      if (!data) {
        setWeatherData(null);
        setWeatherError('Météo indisponible pour le moment.');
      } else {
        setWeatherData(data);
      }
      setWeatherLoading(false);
    };

    loadWeather();
    const id = setInterval(loadWeather, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [start?.lat, start?.lng]);

  const hourlyForecast = useMemo(() => {
    const times = weatherData?.hourly?.time || [];
    const temps = weatherData?.hourly?.temperature_2m || [];
    const rainProb = weatherData?.hourly?.precipitation_probability || [];
    const codes = weatherData?.hourly?.weather_code || [];
    const wind = weatherData?.hourly?.wind_speed_10m || [];
    const now = Date.now();

    const out = [];
    for (let i = 0; i < times.length; i += 1) {
      const ts = new Date(times[i]).getTime();
      if (!Number.isFinite(ts) || ts < now) continue;
      out.push({
        time: times[i],
        temp: temps[i],
        rainProb: rainProb[i],
        code: codes[i],
        wind: wind[i],
      });
      if (out.length >= 8) break;
    }
    return out;
  }, [weatherData]);

  const dailyForecast = useMemo(() => {
    const times = weatherData?.daily?.time || [];
    const max = weatherData?.daily?.temperature_2m_max || [];
    const min = weatherData?.daily?.temperature_2m_min || [];
    const rain = weatherData?.daily?.precipitation_probability_max || [];
    const codes = weatherData?.daily?.weather_code || [];
    const out = [];
    for (let i = 0; i < times.length && i < 3; i += 1) {
      out.push({
        time: times[i],
        max: max[i],
        min: min[i],
        rainProb: rain[i],
        code: codes[i],
      });
    }
    return out;
  }, [weatherData]);

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Tableau Participant</h2>
            <p className="muted">Course: {race?.name || runnerSession?.raceName || '—'} · Équipe {runnerSession?.teamName || '—'}</p>
          </div>
          <span className="pill">Code {runnerSession?.code || '—'}</span>
        </div>
        <div className="stats-grid">
          <StatCard icon={<Flag size={18} />} label="Balises" value={`${runnerProgress}/${totalCheckpoints}`} sub="validées" />
          <StatCard icon={<Flag size={18} />} label="Position" value={`${currentLabel} → ${nextLabel}`} sub={`${Math.round(runnerLegProgress * 100)}%`} />
        </div>
        <div className="runner-actions">
          <button className="btn btn-success" onClick={onValidate} disabled={runnerProgress >= totalCheckpoints || runnerLegProgress < 1}>Valider la prochaine balise</button>
        </div>
      </section>

      <section className="card map-card">
        <h3 className="card-title">Carte des balises</h3>
        <div className="map-shell">
          <MapContainer center={[start.lat, start.lng]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <CircleMarker center={[start.lat, start.lng]} radius={7} pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.8 }}><Popup>Départ</Popup></CircleMarker>
            {canSeeBalises && (runnerSession?.order || []).map((cp, index) => {
              if (index > nextIndex) return null;
              const isDone = index < runnerProgress;
              const isNext = index === nextIndex;
              const color = isDone ? '#22c55e' : isNext ? '#f59e0b' : '#94a3b8';
              return <NumberedMarker key={`${cp.lat}-${cp.lng}-${index}`} position={[cp.lat, cp.lng]} number={index + 1} color={color} />;
            })}
          </MapContainer>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Balise actuelle</h3>
        {!canSeeOrdreBalises && <p className="muted">Accès à l'ordre des balises non autorisé.</p>}
        {canSeeOrdreBalises && (
          <>
            {totalCheckpoints === 0 && <p className="muted">Aucune balise définie.</p>}
            {isFinished && totalCheckpoints > 0 && <p className="muted">Parcours terminé ✅</p>}
            {!isFinished && nextCheckpoint && (
              <ol className="checkpoint-list">
                <li className="checkpoint checkpoint--next">Balise {nextIndex + 1} · {nextCheckpoint.lat.toFixed(4)}, {nextCheckpoint.lng.toFixed(4)}</li>
              </ol>
            )}
            {runnerProgress > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <p className="muted" style={{ marginBottom: '0.35rem' }}>Balises validées</p>
                <ol className="checkpoint-list">
                  {(runnerSession?.order || []).slice(0, runnerProgress).map((cp, index) => (
                    <li key={`${cp.lat}-${cp.lng}-${index}`} className="checkpoint checkpoint--done">Balise {index + 1} · {cp.lat.toFixed(4)}, {cp.lng.toFixed(4)}</li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CloudSun size={18} style={{ color: 'var(--info)' }} /> Météo & prévisions
        </h3>
        {weatherLoading && <p className="muted">Chargement météo…</p>}
        {!weatherLoading && weatherError && <p className="muted">{weatherError}</p>}

        {!weatherLoading && !weatherError && weatherData?.current && (
          <div className="runner-weather-now">
            <div className="runner-weather-main">
              <div className="runner-weather-temp">{Math.round(weatherData.current.temperature_2m)}°C</div>
              <div className="muted">{weatherCodeToLabel(weatherData.current.weather_code)}</div>
            </div>
            <div className="runner-weather-meta">
              <span><Wind size={14} /> {Math.round(weatherData.current.wind_speed_10m || 0)} km/h</span>
              <span>Humidité {Math.round(weatherData.current.relative_humidity_2m || 0)}%</span>
              <span>Précip. {Math.round(weatherData.current.precipitation || 0)} mm</span>
            </div>
          </div>
        )}

        {!weatherLoading && !weatherError && hourlyForecast.length > 0 && (
          <>
            <p className="muted" style={{ marginTop: '0.85rem', marginBottom: '0.35rem' }}>Heures à venir</p>
            <div className="runner-weather-hourly-grid">
              {hourlyForecast.map((h, i) => (
                <div key={`${h.time}-${i}`} className="runner-weather-chip">
                  <strong>{formatHourLabel(h.time)}</strong>
                  <span>{Math.round(h.temp)}°C</span>
                  <span>{weatherCodeToLabel(h.code)}</span>
                  <span>🌧 {Math.round(h.rainProb || 0)}%</span>
                </div>
              ))}
            </div>
          </>
        )}

        {!weatherLoading && !weatherError && dailyForecast.length > 0 && (
          <>
            <p className="muted" style={{ marginTop: '0.85rem', marginBottom: '0.35rem' }}>Prochains 3 jours</p>
            <div className="runner-weather-daily-grid">
              {dailyForecast.map((d, i) => (
                <div key={`${d.time}-${i}`} className="runner-weather-day-card">
                  <strong>{formatDayLabel(d.time)}</strong>
                  <span>{weatherCodeToLabel(d.code)}</span>
                  <span>{Math.round(d.min)}°C / {Math.round(d.max)}°C</span>
                  <span>Pluie max: {Math.round(d.rainProb || 0)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
