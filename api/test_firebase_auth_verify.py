import os
import unittest
from unittest.mock import patch

import jwt

import firebase_auth as fa


class TestFirebaseAuthVerify(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["AUTH_TEST_MODE"] = "0"
        os.environ["REQUIRE_FIREBASE_AUTH"] = "1"
        os.environ["FIREBASE_PROJECT_ID"] = "money-management-e380f"
        os.environ["USE_FIREBASE_ADMIN_VERIFY"] = "0"

    def tearDown(self) -> None:
        for k in ("AUTH_TEST_MODE", "REQUIRE_FIREBASE_AUTH", "FIREBASE_PROJECT_ID", "USE_FIREBASE_ADMIN_VERIFY"):
            try:
                os.environ.pop(k, None)
            except Exception:
                pass

    def test_verify_with_cert_public_key_conversion(self):
        # generate RSA key + self-signed cert
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        import datetime

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = private_key.public_key()

        subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
        # Python 3.10 호환: datetime.UTC 는 3.11+ 에서만 제공된다.
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(public_key)
            .serial_number(x509.random_serial_number())
            .not_valid_before(now_utc - datetime.timedelta(minutes=5))
            .not_valid_after(now_utc + datetime.timedelta(days=1))
            .sign(private_key=private_key, algorithm=hashes.SHA256())
        )
        cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")

        project_id = fa.get_firebase_project_id()
        issuer_url = f"https://securetoken.google.com/{project_id}"

        # exp는 충분히 미래로 둬서(환경 시계 오차에도) 테스트가 흔들리지 않게 한다.
        now = int(now_utc.timestamp())
        claims = {
            "sub": "u1",
            "aud": project_id,
            "iss": issuer_url,
            "iat": now,
            "exp": now + 365 * 24 * 3600,
            "email": "a@example.com",
        }
        token = jwt.encode(
            claims,
            key=private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            ),
            algorithm="RS256",
            headers={"kid": "k1"},
        )

        with patch.object(fa, "_get_google_certs", return_value={"k1": cert_pem}):
            out = fa.verify_firebase_id_token_from_headers({"Authorization": f"Bearer {token}"})
            self.assertEqual(out.get("email"), "a@example.com")
            self.assertEqual(out.get("aud"), project_id)


if __name__ == "__main__":
    unittest.main()

