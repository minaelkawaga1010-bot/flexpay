# FlexPay

Financial OS for migrant workers in the Gulf — multi-currency wallet, EWA, remittance, credit, Hafiza savings circles, and voice UX. UAE-resident (`me-central-1`).

## Repository layout

```
backend/          FastAPI + SQLAlchemy + Alembic
mobile/           Flutter (iOS + Android) with Riverpod
infra/terraform/  AWS me-central-1 (VPC, EKS, RDS, Redis, S3, KMS)
docs/             Requirements, API spec, threat model, handbooks
.github/          CI workflows
```

## Quick start

```bash
# Backend
make backend-install
make backend-test
make backend-run                # → http://localhost:8000/docs

# Local stack (postgres + redis + api)
make up
make down

# Mobile
cd mobile && flutter pub get && flutter run \
  --dart-define=FLEXPAY_API_BASE=http://10.0.2.2:8000/v1

# Infra
make infra-plan                 # terraform plan against me-central-1
```

## Documentation

See `docs/`:

1. [Platform requirements analysis](docs/01_platform_requirements_analysis.md)
2. [Support agent handbook](docs/02_support_agent_handbook.md)
3. [Launch readiness & next steps](docs/03_launch_readiness_and_next_steps.md)
4. [API specification](docs/04_api_spec.md)
5. [Threat model (STRIDE)](docs/05_threat_model.md)
6. [Investor pitch deck](docs/06_pitch_deck.md)

## Status

Beta scaffold — backend has passing tests for OTP auth, wallet, top-up, P2P, and idempotency. Mobile boots to login and renders a wallet home once authenticated. Infra is a clean `terraform plan` target; nothing is applied.

See the launch-readiness doc for the go-live gate list.
