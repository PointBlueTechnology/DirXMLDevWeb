package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.pointblue.dirxml.dev.deploy.Servers;
import com.pointblue.dirxml.dev.model.Driver;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.xml.CanonicalXml;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;
import org.w3c.dom.Element;

/**
 * The GCV tab on a driver set served by several servers (#134): idm1 is the primary, idm2 holds its own copy of
 * the driver's values (drv.users = b, drv.extra only there), idm3 follows the primary. The view names the
 * servers, the primary first, and says per driver GCV where another server's value differs.
 */
public class ConfigViewsServersTest {

    private static final String S1 = "cn=idm1,ou=servers,o=system";
    private static final String S2 = "cn=idm2,ou=servers,o=system";
    private static final String S3 = "cn=idm3,ou=servers,o=system";

    private static Element xml(String s) {
        return CanonicalXml.parse(s).getDocumentElement();
    }

    private static DriverSet set(boolean servers) {
        DriverSet ds = new DriverSet("Set");
        ds.dn = "cn=Set,o=system";
        Driver d = new Driver("AD");
        d.dn = "cn=AD,cn=Set,o=system";
        d.shimClass = "com.example.Shim";
        d.config.put(Driver.CONFIG_VALUES, xml("<configuration-values><definitions>"
            + "<definition display-name=\"u\" name=\"drv.users\" type=\"string\"><value>a</value></definition>"
            + "<definition display-name=\"o\" name=\"drv.ou\" type=\"string\"><value>o</value></definition></definitions></configuration-values>"));
        ds.drivers.add(d);
        if (servers) {
            ds.servers.addAll(List.of(S2, S1, S3));
            ds.meta.put(Servers.PRIMARY_META, S1);
            Map<String, Element> own = new LinkedHashMap<>();
            own.put(Driver.CONFIG_VALUES, xml("<configuration-values><definitions>"
                + "<definition display-name=\"u\" name=\"drv.users\" type=\"string\"><value>b</value></definition>"
                + "<definition display-name=\"o\" name=\"drv.ou\" type=\"string\"><value>o</value></definition>"
                + "<definition display-name=\"x\" name=\"drv.extra\" type=\"string\"><value>x</value></definition></definitions></configuration-values>"));
            d.serverConfig.put(S2, own);
        }
        return ds;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> row(Map<String, Object> view, String name) {
        for (Object o : (List<Object>) view.get("gcvs")) {
            Map<String, Object> r = (Map<String, Object>) o;
            if (name.equals(r.get("name"))) {
                return r;
            }
        }
        return null;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void serversAndWhereAValueDiffers() {
        DriverSet ds = set(true);
        Map<String, Object> view = ConfigViews.driver(ds, ds.driver("AD"));
        List<Object> servers = (List<Object>) view.get("servers");
        assertEquals(3, servers.size());
        Map<String, Object> first = (Map<String, Object>) servers.get(0);
        assertEquals("the primary first", "idm1", first.get("name"));
        assertEquals(true, first.get("primary"));

        assertEquals(Map.of(S2, "b"), row(view, "drv.users").get("onServers"));
        assertTrue("same everywhere", ((Map<String, Object>) row(view, "drv.ou").get("onServers")).isEmpty());

        Map<String, Object> extra = row(view, "drv.extra");
        assertEquals("not defined on idm1", extra.get("absent"));
        assertEquals(Map.of(S2, "x"), extra.get("onServers"));
    }

    @Test
    public void aSingleServerSetHasNone() {
        DriverSet ds = set(false);
        Map<String, Object> view = ConfigViews.driver(ds, ds.driver("AD"));
        assertTrue(((List<?>) view.get("servers")).isEmpty());
        assertTrue(((Map<?, ?>) row(view, "drv.users").get("onServers")).isEmpty());
        assertNull(row(view, "drv.extra"));
        assertFalse(row(view, "drv.users").containsKey("absent"));
    }
}
