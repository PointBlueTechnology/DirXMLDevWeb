package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.deploy.Servers;
import com.pointblue.dirxml.dev.edit.GcvOps;
import com.pointblue.dirxml.dev.model.Artifact;
import com.pointblue.dirxml.dev.model.Driver;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.model.PolicyLink;
import com.pointblue.dirxml.dev.model.PolicySet;
import com.pointblue.dirxml.dev.model.Resource;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * Configuration as an editor needs it: every {@code <definition>} of a configuration document
 * as a row (name, type, value, choices), and the GCVs in a driver's scope with where each one
 * is defined — resolved by the core's own lookup ({@link GcvOps#find}), so the editor shows the
 * value the engine would use and edits the place {@code gcv.set} would write.
 */
final class ConfigViews {

    /** Definition types whose value is one scalar an input can hold. */
    private static final Set<String> SCALAR = Set.of("string", "boolean", "integer", "enum", "dn", "real", "password-ref", "");

    private ConfigViews() {
    }

    static Map<String, Object> driver(DriverSet ds, Driver d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("driver", d.name);
        m.put("shimClass", d.shimClass);
        m.put("shimAuthServer", d.shimAuthServer);
        m.put("shimAuthId", d.shimAuthId);
        // the environments it is deployed to (empty = every one), and what each environment's vault calls it where that differs
        m.put("environments", d.environments);
        m.put("planned", d.planned);
        Map<String, String> names = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, String>> e : ds.overrides.entrySet()) {
            String n = com.pointblue.dirxml.dev.deploy.Overrides.renames(e.getValue()).get(d.name);
            if (n != null) {
                names.put(e.getKey(), n);
            }
        }
        m.put("environmentNames", names);
        m.put("params", definitions(d.config.get(Driver.SHIM_CONFIG_INFO), null));
        m.put("ecvs", definitions(d.config.get(Driver.ENGINE_CONTROL_VALUES), null));
        m.put("gcvs", gcvs(ds, d));
        m.put("servers", servers(ds));
        return m;
    }

    /**
     * The servers of a set served by several (#134), the primary first: each holds its own copy of a driver's
     * GCVs, and the tree's are the primary's. Empty on a single-server set, or when the tree doesn't record
     * which server it was read through.
     */
    static List<Object> servers(DriverSet ds) {
        List<Object> out = new ArrayList<>();
        String primary = ds.meta.get(Servers.PRIMARY_META);
        if (ds.servers.size() < 2 || primary == null) {
            return out;
        }
        List<String> order = new ArrayList<>();
        order.add(primary);
        order.addAll(Servers.others(ds, primary));
        for (String dn : order) {
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("dn", dn);
            s.put("name", Servers.dirName(dn));
            s.put("primary", dn.equalsIgnoreCase(primary));
            out.add(s);
        }
        return out;
    }

    static Map<String, Object> driverSet(DriverSet ds) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("driver", null);
        m.put("gcvs", gcvs(ds, null));
        return m;
    }

    /** The GCVs the engine would resolve for {@code d} (null: the driver set), each from the place that wins. */
    static List<Object> gcvs(DriverSet ds, Driver d) {
        Set<String> names = new LinkedHashSet<>();
        if (d != null) {
            collectNames(d.config.get(Driver.CONFIG_VALUES), names);
            for (PolicyLink l : d.links(PolicySet.GCV)) {
                Artifact a = ds.resolve(l.ref);
                if (a instanceof Resource && ((Resource) a).content != null) {
                    collectNames(((Resource) a).content, names);
                }
            }
        }
        collectNames(ds.configValues, names);
        for (Resource r : ds.library.resources) {
            if (r.isGcvDef() && r.content != null) {
                collectNames(r.content, names);
            }
        }
        Map<String, Artifact> index = ds.index();
        List<Object> out = new ArrayList<>();
        for (String name : names) {
            GcvOps.Home home = GcvOps.find(ds, d, name, index);
            if (home == null) {
                continue;   // defined somewhere this scope does not reach
            }
            String owner = home.resource != null ? home.resource.path()
                : d != null && within(home.definition, d.config.get(Driver.CONFIG_VALUES)) ? "drivers/" + d.name : "driverset";
            Map<String, Object> row = row(home.definition);
            row.put("owner", owner);
            // where it comes from, for the page to group: the driver's own values, a GCV resource the
            // driver links (a package's), or the driver set's — its own values or a Library resource it
            // links, shared by every driver
            String scope;
            if (home.resource == null) {
                scope = owner.equals("driverset") ? "driverset" : "driver";
            } else {
                boolean driverLinked = false;
                if (d != null) {
                    for (PolicyLink l : d.links(PolicySet.GCV)) {
                        if (l.ref.equals(home.resource.path())) {
                            driverLinked = true;
                        }
                    }
                }
                scope = driverLinked ? "driver-link" : "driverset-link";
            }
            row.put("scope", scope);
            row.put("overrideKey", owner.equals("driverset") && d == null ? "driverset.gcv." + name
                : d != null ? "drivers/" + d.name + ".gcv." + name : "driverset.gcv." + name);
            // where it is read: policies by artifact path, configuration documents by their file
            List<Object> uses = new ArrayList<>();
            for (GcvOps.Use u : GcvOps.usage(ds, d, name)) {
                Map<String, Object> um = new LinkedHashMap<>();
                um.put("kind", u.kind);
                um.put("path", u.path);
                if (!"policy".equals(u.kind) && u.driver != null) {
                    um.put("file", "drivers/" + com.pointblue.dirxml.dev.ascode.AsCodeWriter.fileSafe(u.driver) + "/" + u.kind + ".xml");
                }
                uses.add(um);
            }
            row.put("usedBy", uses);
            if ("driver".equals(scope)) {
                row.put("onServers", GcvOps.onServers(ds, d, name));
            }
            out.add(row);
        }
        // a GCV only another server's copy of the driver's values defines: no value on the primary
        if (d != null) {
            for (String name : GcvOps.onlyOnServers(d)) {
                if (GcvOps.find(ds, d, name, index) != null) {
                    continue;
                }
                Map<String, String> on = GcvOps.onServers(ds, d, name);
                Element def = null;
                for (String dn : on.keySet()) {
                    Map<String, Element> own = d.serverConfig.get(dn);
                    def = own == null ? null : GcvOps.definition(own.get(Driver.CONFIG_VALUES), name);
                    if (def != null) {
                        break;
                    }
                }
                if (def == null) {
                    continue;
                }
                Map<String, Object> row = row(def);
                row.put("value", "");
                row.put("owner", "drivers/" + d.name);
                row.put("scope", "driver");
                row.put("overrideKey", "drivers/" + d.name + ".gcv." + name);
                row.put("usedBy", List.of());
                row.put("onServers", on);
                String primary = ds.meta.get(Servers.PRIMARY_META);
                row.put("absent", "not defined on " + (primary == null ? "the primary server" : Servers.dirName(primary)));
                out.add(row);
            }
        }
        return out;
    }

    private static boolean within(Element e, Element root) {
        for (Node n = e; n != null; n = n.getParentNode()) {
            if (n == root) {
                return true;
            }
        }
        return false;
    }

    private static void collectNames(Element root, Set<String> names) {
        if (root == null) {
            return;
        }
        NodeList defs = root.getElementsByTagName("definition");
        for (int i = 0; i < defs.getLength(); i++) {
            String n = ((Element) defs.item(i)).getAttribute("name");
            if (!n.isBlank()) {
                names.add(n);
            }
        }
    }

    /** Every definition under {@code root}, in document order; {@code owner} is recorded when given. */
    static List<Object> definitions(Element root, String owner) {
        List<Object> out = new ArrayList<>();
        if (root == null) {
            return out;
        }
        NodeList defs = root.getElementsByTagName("definition");
        for (int i = 0; i < defs.getLength(); i++) {
            Element def = (Element) defs.item(i);
            if (def.getAttribute("name").isBlank()) {
                continue;
            }
            Map<String, Object> row = row(def);
            if (owner != null) {
                row.put("owner", owner);
            }
            out.add(row);
        }
        return out;
    }

    private static Map<String, Object> row(Element def) {
        Map<String, Object> row = new LinkedHashMap<>();
        String type = def.getAttribute("type");
        row.put("name", def.getAttribute("name"));
        row.put("displayName", def.hasAttribute("display-name") ? def.getAttribute("display-name") : def.getAttribute("name"));
        row.put("type", type);
        Element value = child(def, "value");
        boolean scalar = SCALAR.contains(type) && (value == null || !hasElementChild(value));
        row.put("value", value == null ? "" : value.getTextContent());
        row.put("editable", scalar);
        Element descr = child(def, "description");
        row.put("description", descr == null ? "" : descr.getTextContent().strip());
        List<Object> choices = new ArrayList<>();
        for (Node n = def.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n instanceof Element && n.getNodeName().equals("enum-choice")) {
                Element c = (Element) n;
                Map<String, Object> cm = new LinkedHashMap<>();
                cm.put("value", c.getTextContent());
                cm.put("label", c.hasAttribute("display-name") ? c.getAttribute("display-name") : c.getTextContent());
                choices.add(cm);
            }
        }
        row.put("choices", choices);
        return row;
    }

    private static Element child(Element e, String name) {
        for (Node n = e.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n instanceof Element && n.getNodeName().equals(name)) {
                return (Element) n;
            }
        }
        return null;
    }

    private static boolean hasElementChild(Element e) {
        for (Node n = e.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n instanceof Element) {
                return true;
            }
        }
        return false;
    }
}
