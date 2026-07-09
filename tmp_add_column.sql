-- Agregar la columna alias_por_estok si no existe
ALTER TABLE inventario_customuser ADD COLUMN IF NOT EXISTS alias_por_estok jsonb DEFAULT '{}'::jsonb;

-- Configurar el alias "Yamza" para ygumy44 en el Estok "El Camarin"
UPDATE inventario_customuser 
SET alias_por_estok = '{"04f9d499-d47c-468a-873d-a6f097660695": "Yamza"}'::jsonb 
WHERE username = 'ygumy44';

-- Verificar
SELECT username, alias_por_estok FROM inventario_customuser WHERE username = 'ygumy44';
