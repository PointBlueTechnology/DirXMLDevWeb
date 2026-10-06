package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The parts of OIDC that need no provider: signatures against a JWK, and the groups claim. */
public class OidcIdentityTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static String b64(byte[] b) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private static String b64(BigInteger i) {
        byte[] b = i.toByteArray();
        if (b[0] == 0) {
            b = java.util.Arrays.copyOfRange(b, 1, b.length);
        }
        return b64(b);
    }

    @Test
    public void anRs256SignatureVerifiesAgainstTheJwkAndATamperedTokenDoesNot() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        KeyPair kp = g.generateKeyPair();
        RSAPublicKey pub = (RSAPublicKey) kp.getPublic();
        Map<String, Object> jwk = Map.of("kty", "RSA", "n", b64(pub.getModulus()), "e", b64(pub.getPublicExponent()));
        byte[] signed = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9".getBytes(StandardCharsets.US_ASCII);
        Signature s = Signature.getInstance("SHA256withRSA");
        s.initSign(kp.getPrivate());
        s.update(signed);
        byte[] sig = s.sign();
        assertTrue(OidcIdentity.signatureHolds("RS256", jwk, signed, sig));
        assertFalse(OidcIdentity.signatureHolds("RS256", jwk, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJldmUifQ".getBytes(StandardCharsets.US_ASCII), sig));
    }

    @Test
    public void anEs256SignatureInJoseFormVerifies() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"));
        KeyPair kp = g.generateKeyPair();
        ECPublicKey pub = (ECPublicKey) kp.getPublic();
        Map<String, Object> jwk = Map.of("kty", "EC", "crv", "P-256", "x", b64(pub.getW().getAffineX()), "y", b64(pub.getW().getAffineY()));
        byte[] signed = "a.b".getBytes(StandardCharsets.US_ASCII);
        Signature s = Signature.getInstance("SHA256withECDSAinP1363Format");
        s.initSign(kp.getPrivate());
        s.update(signed);
        assertTrue(OidcIdentity.signatureHolds("ES256", jwk, signed, s.sign()));
    }

    @Test
    public void groupsComeFromADottedClaimPath() throws Exception {
        Path f = tmp.newFolder().toPath().resolve("h.properties");
        Files.writeString(f, "public.url=https://x\nrepo.url=r\noidc.issuer=https://kc/realms/idm\noidc.clientId=idmweb\noidc.groupsClaim=realm_access.roles\n");
        OidcIdentity o = new OidcIdentity(Hosted.load(f));
        assertEquals(List.of("idm-editors", "offline_access"), o.groups(Map.of("realm_access", Map.of("roles", List.of("idm-editors", "offline_access")))));
        assertEquals(List.of(), o.groups(Map.of("sub", "x")));
        Files.writeString(f, "public.url=https://x\nrepo.url=r\noidc.issuer=https://kc/realms/idm\noidc.clientId=idmweb\n");
        assertEquals(List.of("idm-editors"), new OidcIdentity(Hosted.load(f)).groups(Map.of("groups", List.of("/idm-editors"))));
    }
}
