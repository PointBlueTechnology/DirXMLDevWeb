package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.pointblue.dirxml.dev.ascode.AsCodeWriter;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.model.DuplicateArtifacts;
import com.pointblue.dirxml.dev.model.Resource;
import com.pointblue.dirxml.dev.model.Scope;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** A Library object from another Library is shown read-only: the outline, the Developer tree, the artifact (DirXMLDev #111). */
public class ReadOnlyLibraryTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static final String SHARED = "cn=Library,ou=shared,o=system";

    private static Resource js(String name) {
        Resource r = new Resource(name, Scope.LIBRARY, null, Resource.ECMASCRIPT);
        r.text = "function " + name.replace('-', '_') + "(){}";
        return r;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void theOtherLibrarysObjectIsReadOnly() throws Exception {
        DriverSet ds = new DriverSet("DS");
        ds.dn = "cn=DS,o=system";
        ds.library.resources.add(js("es-own"));
        Resource shared = js("es-shared");
        shared.meta.put(DuplicateArtifacts.LIBRARY_DN, SHARED);
        ds.library.resources.add(shared);
        Path tree = tmp.newFolder("tree").toPath();
        AsCodeWriter.write(ds, tree);
        try (Watcher w = new Watcher(tree, 10_000)) {
            TreeService service = new TreeService(tree, w);

            Map<String, Object> other = service.artifact("library/es-shared");
            assertEquals(SHARED, other.get("readOnly"));
            assertEquals(false, other.get("editable"));
            Map<String, Object> own = service.artifact("library/es-own");
            assertNull(own.get("readOnly"));
            assertEquals(true, own.get("editable"));

            List<Map<String, Object>> resources = (List<Map<String, Object>>) ((Map<String, Object>) service.outline().get("library")).get("resources");
            for (Map<String, Object> n : resources) {
                assertEquals(n.get("name").equals("es-shared") ? SHARED : null, n.get("readOnly"));
            }
            String dev = String.valueOf(service.developer());
            assertTrue(dev, dev.contains("readOnly=" + SHARED));
            assertFalse(dev.contains("readOnly=null"));
        }
    }
}
