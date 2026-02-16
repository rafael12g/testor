# Orient-Express Sim (React + Vue Map + Backend SQL)

## Démarrage rapide (SQLite)

1. Installer les dépendances:
	- `npm install`
2. Lancer frontend + backend:
	- `npm run dev:full`
3. Ouvrir:
	- http://localhost:5173/

Backend API:
- http://localhost:8787/api/health

## Mode MySQL + phpMyAdmin (BDD SQL réelle)

1. Lancer MySQL + phpMyAdmin:
	- `npm run sql:up`
2. Lancer l'app avec backend MySQL:
	- `npm run dev:full:mysql`
3. Ouvrir phpMyAdmin:
	- http://localhost:8080/
	- utilisateur: `orienteering`
	- mot de passe: `orienteering`

La table `beacon_pings` est créée automatiquement au démarrage du backend.

## Temps réel

- Les pings balises sont envoyés vers `/api/beacons/ping`
- Les mises à jour live passent aussi par WebSocket sur `/ws`
- Les logs serveur sont exposés via `/api/logs`
