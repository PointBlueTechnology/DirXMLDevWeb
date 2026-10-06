package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Properties;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Edits that keep the rest of the file, and values Properties reads back as written. */
public class PropertiesFileTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void setReplacesInPlaceAndKeepsCommentsAndOrder() throws Exception {
        Path f = tmp.newFile("e.properties").toPath();
        Files.writeString(f, "# labs\nstg.url=ldaps://a:636\nstg.bindDn=cn=x\n\nprd.url=ldaps://b:636\n");
        PropertiesFile p = new PropertiesFile(f);
        p.set("stg.url", "ldaps://c:636");
        p.set("stg.tier", "stg");
        p.remove("prd.url");
        p.save();
        assertEquals("# labs\nstg.url=ldaps://c:636\nstg.bindDn=cn=x\n\nstg.tier=stg\n", Files.readString(f));
        Map<String, String> e = new PropertiesFile(f).entries();
        assertEquals("cn=x", e.get("stg.bindDn"));
        assertNull(e.get("prd.url"));
    }

    @Test
    public void anEnvironmentsValueWithBackslashesReadsBackThroughProperties() throws Exception {
        Path f = tmp.newFile("e.properties").toPath();
        PropertiesFile p = new PropertiesFile(f);
        p.set("x.password", " p\\ss w0rd=:#");
        p.set("x.bindDn", "cn=admin,ou=sa,o=system");
        p.save();
        Properties read = CredentialService.load(f);
        assertEquals(" p\\ss w0rd=:#", read.getProperty("x.password"));
        assertEquals("cn=admin,ou=sa,o=system", read.getProperty("x.bindDn"));
        assertNull(PropertiesFile.keyOf("  # comment", false));
    }

    @Test
    public void aSecretsFileKeepsDriverNamesWithSpacesAndRawValues() throws Exception {
        Path f = tmp.newFile("s.properties").toPath();
        Files.writeString(f, "# secrets\nAD Driver.shim-auth-password = old\n");
        PropertiesFile p = new PropertiesFile(f, true);
        p.set("AD Driver.shim-auth-password", "p\\ss w0rd=:#");
        p.set("AD Driver.named.svcKeychain", "idm-stg/AD Driver.named.svc");
        p.save();
        assertEquals("# secrets\nAD Driver.shim-auth-password=p\\ss w0rd=:#\nAD Driver.named.svcKeychain=idm-stg/AD Driver.named.svc\n", Files.readString(f));
        Properties read = com.pointblue.dirxml.dev.deploy.Secrets.parse(Files.readString(f));
        assertEquals("p\\ss w0rd=:#", read.getProperty("AD Driver.shim-auth-password"));
        assertEquals("AD Driver.shim-auth-password", PropertiesFile.keyOf("AD Driver.shim-auth-password=x", true));
        assertEquals("AD Driver.shim-auth-password", new PropertiesFile(f, true).entries().keySet().iterator().next());
    }

    @Test
    public void theSourceKindNamesHowACredentialIsConfigured() {
        assertEquals("literal", CredentialService.sourceKind(Map.of("stg.password", "x"), "stg.password"));
        assertEquals("keychain", CredentialService.sourceKind(Map.of("stg.passwordKeychain", "idm-stg/cn=a"), "stg.password"));
        assertEquals("env", CredentialService.sourceKind(Map.of("stg.passwordEnv", "V"), "stg.password"));
        assertNull(CredentialService.sourceKind(Map.of("stg.url", "u"), "stg.password"));
    }
}
