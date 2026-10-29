package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertSame;

import com.pointblue.dirxml.dev.model.DriverSet;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * The schema and provisioning reads share the outline's copy of the tree instead of reading it
 * from disk on each request (#177), and still see a change written a moment ago.
 */
public class SharedModelTest {

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
    public void readsShareOneModelUntilAFileChanges() throws Exception {
        Path tree = tree();
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);
            DriverSet first = service.withModel(ds -> ds);
            assertSame("a second read reuses the model", first, service.withModel(ds -> ds));

            // a new driver, written without the watcher running: the next read sees it at once
            Files.writeString(tree.resolve("driverset.xml"), "<driver-set name=\"S\"><driver name=\"Plain\" dir=\"drivers/Plain\"/>"
                + "<driver name=\"Other\" dir=\"drivers/Other\"/></driver-set>\n");
            Files.setLastModifiedTime(tree.resolve("driverset.xml"), FileTime.fromMillis(System.currentTimeMillis() + 5_000));
            Files.createDirectories(tree.resolve("drivers/Other"));
            Files.writeString(tree.resolve("drivers/Other/driver.xml"), "<driver name=\"Other\"/>\n");
            DriverSet second = service.withModel(ds -> ds);
            assertNotSame(first, second);
            assertEquals(2, second.drivers.size());
        }
    }

    @Test
    public void theServicesReadThroughTheSharedModel() throws Exception {
        Path tree = tree();
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);
            VaultService vault = new VaultService(tree, EnvFiles.single(tree.resolve("no-such-environments.properties")));
            vault.models(service);
            ProvisioningService prov = new ProvisioningService(tree);
            prov.models(service);

            assertEquals(Boolean.FALSE, vault.appSchema("Plain").get("present"));
            assertEquals(Boolean.FALSE, vault.schema().get("present"));
            assertEquals("[]", prov.catalog().get("drivers").toString());
        }
    }
}
