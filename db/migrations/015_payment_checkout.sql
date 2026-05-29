-- Sprint 17 — Real Payments Core
-- Persistência de dados de checkout (Pix) e snapshot do prazo de contexto,
-- para que o frontend possa exibir o checkout e fazer polling em GET /payments/:id.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS checkout_pix_copy_paste text NULL,
  ADD COLUMN IF NOT EXISTS checkout_pix_qr_code text NULL,
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS context_expires_at timestamptz NULL;
