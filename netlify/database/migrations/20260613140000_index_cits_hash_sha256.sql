-- RODAID — Indice de verificacion publica del CIT.
--
-- El Modulo de Documentos PDF genera un codigo QR en cada certificado que
-- apunta a /verificar/:serialHash, donde :serialHash es el hash SHA-256 con
-- el que se sello el CIT. La verificacion publica resuelve un certificado a
-- partir de ese hash, de modo que conviene tener un indice sobre la columna
-- para que la busqueda sea directa en lugar de un scan secuencial.
--
-- Roll-forward seguro: solo agrega un indice, no modifica datos ni migraciones
-- ya aplicadas. WHERE hash_sha256 IS NOT NULL mantiene el indice pequeno
-- (los borradores aun no sellados no tienen hash).

CREATE INDEX IF NOT EXISTS idx_cits_hash_sha256
  ON cits (hash_sha256)
  WHERE hash_sha256 IS NOT NULL;
