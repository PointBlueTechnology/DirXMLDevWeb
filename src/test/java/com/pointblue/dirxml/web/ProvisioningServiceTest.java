package com.pointblue.dirxml.web;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The provisioning reads say plainly what is missing. */
public class ProvisioningServiceTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private Path tree() throws Exception {
        Path t = tmp.newFolder("tree").toPath();
        Files.writeString(t.resolve("driverset.xml"), "<driver-set name=\"S\"><driver name=\"Plain\" dir=\"drivers/Plain\"/></driver-set>\n");
        Files.createDirectories(t.resolve("drivers/Plain"));
        Files.writeString(t.resolve("drivers/Plain/driver.xml"), "<driver name=\"Plain\"/>\n");
        return t;
    }

    @Test
    public void aDriverWithoutProvisioningAndAnUnknownDriverAre404() throws Exception {
        ProvisioningService p = new ProvisioningService(tree());
        try {
            p.prd("Plain", "X");
            fail();
        } catch (TreeService.NotFound e) {
            assertTrue(e.getMessage(), e.getMessage().contains("no provisioning"));
        }
        try {
            p.form("Nope", "X");
            fail();
        } catch (TreeService.NotFound e) {
            assertTrue(e.getMessage(), e.getMessage().contains("no driver"));
        }
        assertTrue(p.catalog().get("drivers").toString().equals("[]"));
    }
}
