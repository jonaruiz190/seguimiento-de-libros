ALTER TABLE tracking DROP CONSTRAINT IF EXISTS tracking_status_check;

ALTER TABLE tracking
  ADD CONSTRAINT tracking_status_check
  CHECK (status IN (
    'Leyendo',
    'Próximo a leer',
    'En pausa',
    'Abandonado',
    'Leído'
  ));
