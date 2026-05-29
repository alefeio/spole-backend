# Dívida técnica (registro)

Este documento registra dívidas técnicas conhecidas, para acompanhamento sprint a sprint, sem bloquear a evolução quando não forem críticas.

## Sprint 00 (encerramento)

### Git e versionamento
- O repositório já está com **Git inicializado** e possui um **commit inicial** (`64f78a2`).
- O `package-lock.json` está **versionado** no repositório.

### Segurança (npm audit)
- Existe pendência de `npm audit` com **vulnerabilidades moderadas** na cadeia de ferramentas de dev/test (Vite/Vitest/esbuild).
- Correção automática sugerida envolve `npm audit fix --force`, o que pode introduzir **breaking changes**.
- Decisão nesta etapa: **não aplicar** correções com breaking change durante o encerramento da Sprint 00.

### Tooling (warning Vitest/Vite)
- Ao rodar os testes, aparece o warning: **“The CJS build of Vite's Node API is deprecated.”**
- Decisão nesta etapa: **registrar** e tratar em momento apropriado, sem alterar o estado funcional atual dos testes.

### Sprint 08 — busca e cache
- A busca textual `q` em `GET /events` usa `ILIKE` com `ESCAPE` em `title` e `description`; em catálogos muito grandes pode exigir índices ou evolução para busca dedicada (fora do escopo atual).

### Sprint 17 — pagamentos reais
- O `AsaasPaymentProvider` **não** foi validado contra o sandbox real do Asaas no CI (sem credenciais). Validação ponta a ponta em sandbox fica como passo manual antes do go-live em produção.
- A criação da cobrança no gateway ocorre **dentro da transação** que mantém o `FOR UPDATE` do contexto (booking/reserva/ocorrência). Para o modo `mock` é instantâneo; no modo `asaas` há uma chamada de rede segurando o lock por um curto período. Em cenários de alta concorrência, considerar criar a cobrança fora da transação (com reconciliação de cobranças órfãs).
- No modo `asaas`, o pagador é um único cliente fixo (`ASAAS_DEFAULT_CUSTOMER_ID`). A criação dinâmica de cliente por usuário (CPF/CNPJ) e o vínculo pagador↔cobrança ficam para evolução futura.
- Estorno/refund (`REFUNDED`) e split/repasse continuam fora de escopo.
