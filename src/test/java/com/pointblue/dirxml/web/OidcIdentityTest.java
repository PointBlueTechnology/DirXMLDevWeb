package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The hosted wiring of OIDC: oidc.groupsClaim reaches the client. The protocol itself is tested in console-auth. */
public class OidcIdentityTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

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
