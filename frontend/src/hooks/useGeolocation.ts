import { useState, useEffect } from 'react';

interface GeolocationState {
  lat: number | null;
  lng: number | null;
  error: string | null;
  loading: boolean;
}

export function useGeolocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>({
    lat: null,
    lng: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    if (!navigator.geolocation) {
      setState({ lat: null, lng: null, error: 'Geolocalização não suportada pelo navegador', loading: false });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          error: null,
          loading: false,
        });
      },
      (err) => {
        let message = 'Não foi possível obter localização';
        if (err.code === err.PERMISSION_DENIED) {
          message = 'Permissão de localização negada';
        }
        setState({ lat: null, lng: null, error: message, loading: false });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  }, []);

  return state;
}
