from __future__ import annotations


def _login(client, phone: str) -> dict:
    r = client.post("/v1/auth/otp/request", json={"phone": phone, "channel": "sms"})
    assert r.status_code == 202, r.text
    rid = r.json()["request_id"]
    r = client.post(
        "/v1/auth/otp/verify",
        json={"request_id": rid, "code": "123456", "device_id": "test-device"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_otp_login_creates_user_and_wallet(client):
    tokens = _login(client, "+971500000001")
    assert tokens["token_type"] == "Bearer"
    assert tokens["user"]["phone"] == "+971500000001"

    auth = {"Authorization": f"Bearer {tokens['access_token']}"}
    r = client.get("/v1/wallet", headers=auth)
    assert r.status_code == 200
    assert r.json()["status"] == "ACTIVE"


def test_topup_and_p2p_transfer(client):
    sender = _login(client, "+971500000010")
    recipient = _login(client, "+971500000011")
    sh = {"Authorization": f"Bearer {sender['access_token']}"}
    rh = {"Authorization": f"Bearer {recipient['access_token']}"}

    r = client.post(
        "/v1/wallet/top-up",
        headers=sh,
        json={"amount": 100_00, "currency": "AED"},
    )
    assert r.status_code == 201, r.text

    r = client.post(
        "/v1/wallet/p2p",
        headers=sh,
        json={
            "recipient_phone": "+971500000011",
            "amount": 40_00,
            "currency": "AED",
            "note": "lunch",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["amount"] == -40_00

    sw = client.get("/v1/wallet", headers=sh).json()
    rw = client.get("/v1/wallet", headers=rh).json()
    assert next(b["available"] for b in sw["balances"] if b["currency"] == "AED") == 60_00
    assert next(b["available"] for b in rw["balances"] if b["currency"] == "AED") == 40_00


def test_p2p_insufficient_funds(client):
    sender = _login(client, "+971500000020")
    _login(client, "+971500000021")
    sh = {"Authorization": f"Bearer {sender['access_token']}"}

    r = client.post(
        "/v1/wallet/p2p",
        headers=sh,
        json={"recipient_phone": "+971500000021", "amount": 1, "currency": "AED"},
    )
    assert r.status_code == 402


def test_p2p_idempotency(client):
    sender = _login(client, "+971500000030")
    _login(client, "+971500000031")
    sh = {"Authorization": f"Bearer {sender['access_token']}"}

    client.post("/v1/wallet/top-up", headers=sh, json={"amount": 50_00, "currency": "AED"})

    body = {
        "recipient_phone": "+971500000031",
        "amount": 10_00,
        "currency": "AED",
        "idempotency_key": "fixed-key-123",
    }
    r1 = client.post("/v1/wallet/p2p", headers=sh, json=body)
    r2 = client.post("/v1/wallet/p2p", headers=sh, json=body)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]

    sw = client.get("/v1/wallet", headers=sh).json()
    assert next(b["available"] for b in sw["balances"] if b["currency"] == "AED") == 40_00
