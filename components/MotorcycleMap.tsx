/**
 * Componente de Mapa de Navegación para Motos (MotorcycleMap).
 * Implementa OpenStreetMap y Leaflet.js a través de react-native-webview.
 * 
 * VENTAJAS CLAVE:
 * 1. 100% Funcional sin necesidad de Google Maps API Key ni facturación.
 * 2. Visualización instantánea de carreteras, curvas y puertos de montaña.
 * 3. Soporte para 3 modos:
 *    - Oscuro (CartoDB Dark Matter): alto contraste con trazado naranja resplandeciente.
 *    - Estándar (OpenStreetMap): visualización clásica de carreteras y poblaciones.
 *    - Satélite (Esri World Imagery): vista aérea satelital real de la calzada y el relieve.
 * 4. Trazado fluido de polilínea en tiempo real (#FF7A00) y marcador dinámico de piloto.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { LocationPoint } from '@/types/ride';
import { LEAFLET_CSS, LEAFLET_JS } from '@/constants/leafletSource';

export type MapMode = 'dark' | 'standard' | 'hybrid';

export interface MotorcycleMapRef {
  recenter: (lat: number, lon: number, zoom?: number) => void;
  fitBounds: (points?: LocationPoint[]) => void;
  moveToPoint: (lat: number, lon: number, followCamera?: boolean) => void;
}

interface MotorcycleMapProps {
  currentCoord: { latitude: number; longitude: number } | null;
  points: LocationPoint[];
  mapMode: MapMode;
  isRecording?: boolean;
  fitBoundsOnLoad?: boolean;
}

const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    ${LEAFLET_CSS}
    html, body, #map {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background-color: #121826;
      overflow: hidden;
      touch-action: none;
    }
    .leaflet-control-attribution, .leaflet-control-zoom {
      display: none !important;
    }
    .dark-tiles img, .dark-tiles {
      filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
    }
    .moto-marker {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .moto-pulse {
      width: 32px;
      height: 32px;
      background: rgba(0, 240, 255, 0.35);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 14px rgba(0, 240, 255, 0.85);
    }
    .moto-dot {
      width: 16px;
      height: 16px;
      background: #00F0FF;
      border: 3px solid #FFFFFF;
      border-radius: 50%;
    }
    .start-dot {
      width: 18px;
      height: 18px;
      background: #39FF14;
      border: 3px solid #FFFFFF;
      border-radius: 50%;
      box-shadow: 0 0 10px rgba(57, 255, 20, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .end-dot {
      width: 18px;
      height: 18px;
      background: #FF0055;
      border: 3px solid #FFFFFF;
      border-radius: 50%;
      box-shadow: 0 0 10px rgba(255, 0, 85, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    ${LEAFLET_JS}
    var map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: true,
      zoomAnimation: true
    }).setView([40.4168, -3.7038], 15);

    // A-11: Capa de teselas con caché offline persistente (Cache API / IndexedDB en WebView)
    // Permite que las carreteras y curvas de montaña sigan visibles sin cobertura móvil.
    var CachedTileLayer = L.TileLayer.extend({
      createTile: function(coords, done) {
        var tile = document.createElement('img');
        L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
        L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));
        if (this.options.crossOrigin || this.options.crossOrigin === '') {
          tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
        }
        tile.alt = '';
        tile.setAttribute('role', 'presentation');

        var url = this.getTileUrl(coords);

        if (typeof window !== 'undefined' && 'caches' in window) {
          caches.open('mototrack-tiles-v1').then(function(cache) {
            return cache.match(url).then(function(cachedResponse) {
              if (cachedResponse) {
                return cachedResponse.blob().then(function(blob) {
                  tile.src = URL.createObjectURL(blob);
                });
              } else {
                fetch(url).then(function(netResponse) {
                  if (netResponse && netResponse.status === 200) {
                    cache.put(url, netResponse.clone());
                    // Poda periódica para evitar crecimiento descontrolado de almacenamiento (límite 1.500 teselas ~25MB)
                    cache.keys().then(function(keys) {
                      if (keys.length > 1500) {
                        var toDelete = keys.slice(0, keys.length - 1500);
                        toDelete.forEach(function(k) { cache.delete(k); });
                      }
                    }).catch(function() {});
                    return netResponse.blob().then(function(blob) {
                      tile.src = URL.createObjectURL(blob);
                    });
                  } else {
                    tile.src = url;
                  }
                }).catch(function() {
                  tile.src = url;
                });
              }
            });
          }).catch(function() {
            tile.src = url;
          });
        } else {
          tile.src = url;
        }

        return tile;
      }
    });

    function createCachedTileLayer(url, options) {
      return new CachedTileLayer(url, options);
    }

    var layers = {
      standard: createCachedTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        crossOrigin: true
      }),
      hybrid: createCachedTileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        crossOrigin: true
      }),
      dark: createCachedTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        className: 'dark-tiles',
        crossOrigin: true
      })
    };

    var currentMode = 'standard';
    layers.standard.addTo(map);

    // Contorno oscuro sutil para garantizar máximo contraste en mapa claro
    var polylineOutline = L.polyline([], {
      color: '#0B0E14',
      weight: 8,
      opacity: 0.65,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Polilínea de la ruta en Cian Neón destacado (grosor 6)
    var polyline = L.polyline([], {
      color: '#00F0FF',
      weight: 6,
      opacity: 1.0,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Marcadores de inicio y final
    var startMarker = null;
    var endMarker = null;

    // Marcador actual del piloto
    var motoIcon = L.divIcon({
      className: 'moto-marker',
      html: '<div class="moto-pulse"><div class="moto-dot"></div></div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    var currentMarker = null;

    function setMapMode(mode) {
      if (layers[mode] && mode !== currentMode) {
        map.removeLayer(layers[currentMode]);
        layers[mode].addTo(map);
        currentMode = mode;
      }
    }

    function updatePosition(lat, lon, autoCenter) {
      var latlng = [lat, lon];
      if (!currentMarker) {
        currentMarker = L.marker(latlng, { icon: motoIcon, zIndexOffset: 1000 }).addTo(map);
      } else {
        currentMarker.setLatLng(latlng);
      }
      if (autoCenter) {
        map.panTo(latlng, { animate: true, duration: 0.5 });
      }
    }

    map.on('dragstart zoomstart', function() {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'user_pan' }));
      }
    });

    function moveToPoint(lat, lon, followCamera) {
      updatePosition(lat, lon, followCamera);
    }

    function updateRoute(pointsInput) {
      try {
        var pts = typeof pointsInput === 'string' ? JSON.parse(pointsInput) : pointsInput;
        if (!Array.isArray(pts) || pts.length === 0) {
          polylineOutline.setLatLngs([]);
          polyline.setLatLngs([]);
          if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
          if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
          return;
        }

        var latlngs = pts.map(function(p) { return [p.latitude, p.longitude]; });
        polylineOutline.setLatLngs(latlngs);
        polyline.setLatLngs(latlngs);

        if (pts.length > 0 && !startMarker) {
          var startIcon = L.divIcon({
            className: 'moto-marker',
            html: '<div class="start-dot" title="Salida"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
          });
          startMarker = L.marker([pts[0].latitude, pts[0].longitude], { icon: startIcon, zIndexOffset: 900 }).addTo(map);
        }

        if (pts.length > 1) {
          if (endMarker) {
            endMarker.setLatLng([pts[pts.length - 1].latitude, pts[pts.length - 1].longitude]);
          } else {
            var endIcon = L.divIcon({
              className: 'moto-marker',
              html: '<div class="end-dot" title="Meta"></div>',
              iconSize: [18, 18],
              iconAnchor: [9, 9]
            });
            endMarker = L.marker([pts[pts.length - 1].latitude, pts[pts.length - 1].longitude], { icon: endIcon, zIndexOffset: 950 }).addTo(map);
          }
        }
      } catch (e) {
        console.error('Error al parsear puntos:', e);
      }
    }

    function appendPoint(lat, lon) {
      var latlng = [lat, lon];
      polylineOutline.addLatLng(latlng);
      polyline.addLatLng(latlng);

      if (!startMarker) {
        var startIcon = L.divIcon({
          className: 'moto-marker',
          html: '<div class="start-dot" title="Salida"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        startMarker = L.marker(latlng, { icon: startIcon, zIndexOffset: 900 }).addTo(map);
      } else {
        if (endMarker) {
          endMarker.setLatLng(latlng);
        } else {
          var endIcon = L.divIcon({
            className: 'moto-marker',
            html: '<div class="end-dot" title="Meta"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
          });
          endMarker = L.marker(latlng, { icon: endIcon, zIndexOffset: 950 }).addTo(map);
        }
      }
    }

    function centerMap(lat, lon, zoom) {
      map.setView([lat, lon], zoom || 16, { animate: true });
    }

    function fitRouteBounds() {
      var bounds = polyline.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [45, 45], animate: true });
      }
    }
  </script>
</body>
</html>
`;

export const MotorcycleMap = forwardRef<MotorcycleMapRef, MotorcycleMapProps>(
  ({ currentCoord, points, mapMode, isRecording = false, fitBoundsOnLoad = false }, ref) => {
    const webViewRef = useRef<WebView>(null);
    const isMapLoaded = useRef(false);

    const userPannedRef = useRef(false);
    const pendingActionsRef = useRef<(() => void)[]>([]);

    useImperativeHandle(ref, () => ({
      recenter: (lat: number, lon: number, zoom = 16) => {
        userPannedRef.current = false;
        const action = () => {
          webViewRef.current?.injectJavaScript(
            `if (window.centerMap) { window.centerMap(${lat}, ${lon}, ${zoom}); } true;`
          );
        };
        if (isMapLoaded.current) {
          action();
        } else {
          pendingActionsRef.current.push(action);
        }
      },
      fitBounds: (pts?: LocationPoint[]) => {
        const action = () => {
          webViewRef.current?.injectJavaScript(
            `if (window.fitRouteBounds) { window.fitRouteBounds(); } true;`
          );
        };
        if (isMapLoaded.current) {
          action();
        } else {
          pendingActionsRef.current.push(action);
        }
      },
      moveToPoint: (lat: number, lon: number, followCamera = false) => {
        const action = () => {
          webViewRef.current?.injectJavaScript(
            `if (window.moveToPoint) { window.moveToPoint(${lat}, ${lon}, ${followCamera ? 'true' : 'false'}); } true;`
          );
        };
        if (isMapLoaded.current) {
          action();
        } else {
          pendingActionsRef.current.push(action);
        }
      },
    }));

    const prevPointsLengthRef = useRef(0);

    // Actualizar modo de mapa (oscuro / estándar / satélite)
    useEffect(() => {
      if (isMapLoaded.current) {
        webViewRef.current?.injectJavaScript(
          `if (window.setMapMode) { window.setMapMode(${JSON.stringify(mapMode)}); } true;`
        );
      }
    }, [mapMode]);

    // Reenganchar cámara automáticamente al iniciar o reanudar grabación
    useEffect(() => {
      if (isRecording) {
        userPannedRef.current = false;
      }
    }, [isRecording]);

    // Actualizar posición actual (H-05: no forzar recentrado si el usuario está desplazando el mapa)
    useEffect(() => {
      if (currentCoord && isMapLoaded.current && Number.isFinite(currentCoord.latitude) && Number.isFinite(currentCoord.longitude)) {
        const autoCenter = isRecording && !userPannedRef.current;
        webViewRef.current?.injectJavaScript(
          `if (window.updatePosition) { window.updatePosition(${currentCoord.latitude}, ${currentCoord.longitude}, ${autoCenter}); } true;`
        );
      }
    }, [currentCoord, isRecording]);

    // Actualizar trazado de polilínea (A-04: O(1) incremental para 1 punto nuevo)
    useEffect(() => {
      if (!isMapLoaded.current) return;

      if (points.length === 0) {
        prevPointsLengthRef.current = 0;
        webViewRef.current?.injectJavaScript(
          `if (window.updateRoute) { window.updateRoute('[]'); } true;`
        );
        return;
      }

      // H-04: Si la cantidad de puntos no ha variado (ej. detenidos en semáforo o descanso), no hacer nada
      if (points.length === prevPointsLengthRef.current) {
        return;
      }

      if (points.length === prevPointsLengthRef.current + 1) {
        const last = points[points.length - 1];
        webViewRef.current?.injectJavaScript(
          `if (window.appendPoint) { window.appendPoint(${last.latitude}, ${last.longitude}); } true;`
        );
        prevPointsLengthRef.current = points.length;
        return;
      }

      // Si llegaron unos pocos puntos en lote (ej. lote de segundo plano de 2 a 10 puntos), anexar incrementalmente
      if (
        prevPointsLengthRef.current > 0 &&
        points.length > prevPointsLengthRef.current &&
        points.length - prevPointsLengthRef.current <= 10
      ) {
        const newPoints = points.slice(prevPointsLengthRef.current);
        const script =
          newPoints
            .map((p) => `if (window.appendPoint) { window.appendPoint(${p.latitude}, ${p.longitude}); }`)
            .join(' ') + ' true;';
        webViewRef.current?.injectJavaScript(script);
        prevPointsLengthRef.current = points.length;
        return;
      }

      // Reconstrucción completa (inicial, restore o salto)
      const pointsData = JSON.stringify(
        points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
      );
      webViewRef.current?.injectJavaScript(
        `if (window.updateRoute) { window.updateRoute(${pointsData}); } true;`
      );
      prevPointsLengthRef.current = points.length;
    }, [points]);

    const handleLoadEnd = () => {
      isMapLoaded.current = true;
      prevPointsLengthRef.current = points.length;

      // Aplicar modo inicial
      webViewRef.current?.injectJavaScript(
        `if (window.setMapMode) { window.setMapMode(${JSON.stringify(mapMode)}); } true;`
      );
      // Aplicar puntos si ya existen
      if (points.length > 0) {
        const pointsData = JSON.stringify(
          points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
        );
        webViewRef.current?.injectJavaScript(
          `if (window.updateRoute) { window.updateRoute(${pointsData}); } true;`
        );
      }
      // Si se solicita ajustar bounds al inicio (en historial/detalle)
      if (fitBoundsOnLoad && points.length > 0) {
        setTimeout(() => {
          webViewRef.current?.injectJavaScript(
            `if (window.fitRouteBounds) { window.fitRouteBounds(); } true;`
          );
        }, 200);
      } else if (currentCoord) {
        // Aplicar coordenadas iniciales si estamos en vivo
        webViewRef.current?.injectJavaScript(
          `if (window.centerMap) { window.centerMap(${currentCoord.latitude}, ${currentCoord.longitude}, 15); } if (window.updatePosition) { window.updatePosition(${currentCoord.latitude}, ${currentCoord.longitude}, true); } true;`
        );
      }

      // Despachar acciones imperativas encoladas una vez cargados el mapa y los puntos (H-01)
      while (pendingActionsRef.current.length > 0) {
        const action = pendingActionsRef.current.shift();
        action?.();
      }
    };

    const handleMessage = (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'user_pan') {
          userPannedRef.current = true;
        }
      } catch (err) {
        // Ignorar mensajes no JSON
      }
    };

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          originWhitelist={['about:blank', 'https://*']}
          source={{ html: LEAFLET_HTML, baseUrl: 'https://mototrack.app' }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          onLoadEnd={handleLoadEnd}
          onMessage={handleMessage}
          style={styles.webView}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#121826',
  },
  webView: {
    flex: 1,
    backgroundColor: '#121826',
  },
});
