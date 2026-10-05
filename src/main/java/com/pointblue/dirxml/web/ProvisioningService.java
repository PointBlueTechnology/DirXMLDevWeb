package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.ascode.AsCodeWriter;
import com.pointblue.dirxml.dev.flow.Flow;
import com.pointblue.dirxml.dev.model.AppObject;
import com.pointblue.dirxml.dev.model.Driver;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.model.Form;
import com.pointblue.dirxml.dev.model.Prd;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;

/**
 * The provisioning side of a driver, read through the core's own models: a PRD's workflow as
 * activities and links ({@link Flow}), a JSON form with the PRDs that bind it, and the role and
 * resource catalog. Reading only: every change is one of the core's operations
 * ({@code flow.*}, {@code prd.*}, {@code form.*}, {@code role.*}, {@code resource.*}) through
 * the same review as any other edit.
 */
public final class ProvisioningService {

    private final Path tree;

    public ProvisioningService(Path tree) {
        this.tree = tree.toAbsolutePath().normalize();
    }

    private Driver driver(DriverSet ds, String name) {
        Driver d = ds.driver(name);
        if (d == null) {
            throw new TreeService.NotFound("no driver '" + name + "'");
        }
        if (d.provisioning == null) {
            throw new TreeService.NotFound("driver '" + name + "' has no provisioning configuration");
        }
        return d;
    }

    /** A PRD: its definition, its request form's fields and the workflow graph. */
    public Map<String, Object> prd(String driverName, String name) throws IOException {
        DriverSet ds = AsCodeReader.read(tree);
        Driver d = driver(ds, driverName);
        Prd prd = d.provisioning.prd(name);
        if (prd == null) {
            throw new TreeService.NotFound("driver '" + driverName + "' has no PRD '" + name + "'");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("driver", d.name);
        m.put("name", prd.name);
        m.put("dir", "drivers/" + AsCodeWriter.fileSafe(d.name) + "/provisioning/prds/" + AsCodeWriter.fileSafe(prd.name));
        m.put("status", prd.definition == null ? null : blankToNull(prd.definition.getAttribute("status")));
        m.put("jsonForms", prd.isJsonForms());
        m.put("properties", prd.properties);
        List<Object> bindings = new ArrayList<>();
        for (Prd.FormBinding b : prd.bindings()) {
            Map<String, Object> one = new LinkedHashMap<>();
            one.put("activity", b.activityId);
            one.put("form", b.formId);
            List<Object> fields = new ArrayList<>();
            for (Prd.Field f : b.fields) {
                Map<String, Object> fm = new LinkedHashMap<>();
                fm.put("name", f.name);
                fm.put("dataType", f.dataType);
                fm.put("control", f.controlType);
                fields.add(fm);
            }
            one.put("fields", fields);
            bindings.add(one);
        }
        m.put("bindings", bindings);
        List<String> formNames = new ArrayList<>();
        for (Form f : d.provisioning.forms) {
            formNames.add(f.name);
        }
        m.put("forms", formNames);
        if (prd.process == null) {
            m.put("flow", null);
            return m;
        }
        Flow flow = Flow.of(prd);
        Map<String, Object> fl = new LinkedHashMap<>();
        Map<String, Object> process = new LinkedHashMap<>();
        process.put("version", flow.version);
        process.put("process-type", flow.processType);
        process.put("flow-strategy", flow.flowStrategy);
        process.put("setnotify", flow.setnotify);
        process.put("restrict-view", flow.restrictView);
        process.put("generate-comments", flow.generateComments);
        process.put("default-completed-approval-status", flow.defaultCompletedApprovalStatus);
        fl.put("process", process);
        List<Object> acts = new ArrayList<>();
        for (Flow.Activity a : flow.activities) {
            Map<String, Object> am = new LinkedHashMap<>();
            am.put("id", a.id);
            am.put("kind", a.kind == Flow.Kind.UNKNOWN ? a.element.getTagName() : a.kind.element.replace("-activity", ""));
            am.put("name", a.displayName(null));
            Map<String, String> attrs = new LinkedHashMap<>();
            NamedNodeMap nm = a.element.getAttributes();
            for (int i = 0; i < nm.getLength(); i++) {
                attrs.put(nm.item(i).getNodeName(), nm.item(i).getNodeValue());
            }
            am.put("attrs", attrs);
            Map<String, String> parts = new LinkedHashMap<>();
            for (Node c = a.element.getFirstChild(); c != null; c = c.getNextSibling()) {
                if (c instanceof Element && !"display-name".equals(c.getNodeName()) && !hasElementChild((Element) c)) {
                    parts.merge(c.getNodeName(), c.getTextContent().trim(), (x, y) -> x + "\n" + y);
                }
            }
            am.put("parts", parts);
            am.put("xml", xml(a.element));
            am.put("linkTypes", a.kind.restrictsOutgoingLinkTypes() ? new ArrayList<>(new TreeSet<>(a.kind.allowedOutgoingLinkTypes())) : Flow.LINK_TYPES);
            List<Object> items = new ArrayList<>();
            for (Flow.DataItem di : flow.dataItemsByActivity.getOrDefault(a.id, List.of())) {
                Map<String, Object> dm = new LinkedHashMap<>();
                dm.put("name", di.name);
                dm.put("dataType", di.dataType);
                dm.put("source", di.source);
                dm.put("target", di.target);
                dm.put("targetType", di.targetType);
                items.add(dm);
            }
            am.put("dataItems", items);
            String form = null;
            for (Flow.FormBinding fb : flow.formBindings) {
                if (a.id.equals(fb.activityId)) {
                    form = fb.formId;
                }
            }
            am.put("form", form);
            acts.add(am);
        }
        fl.put("activities", acts);
        List<Object> links = new ArrayList<>();
        for (Flow.Link l : flow.links) {
            Map<String, Object> lm = new LinkedHashMap<>();
            lm.put("from", l.source);
            lm.put("to", l.target);
            lm.put("type", l.type);
            links.add(lm);
        }
        fl.put("links", links);
        fl.put("linkTypes", Flow.LINK_TYPES);
        m.put("flow", fl);
        return m;
    }

    private static boolean hasElementChild(Element e) {
        for (Node c = e.getFirstChild(); c != null; c = c.getNextSibling()) {
            if (c instanceof Element) {
                return true;
            }
        }
        return false;
    }

    private static String xml(Element e) {
        try {
            Transformer t = TransformerFactory.newInstance().newTransformer();
            t.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "yes");
            t.setOutputProperty(OutputKeys.INDENT, "yes");
            StringWriter w = new StringWriter();
            t.transform(new DOMSource(e), new StreamResult(w));
            return w.toString();
        } catch (TransformerException ex) {
            return "";
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    /** A JSON form: its document, and each PRD activity that shows it. */
    public Map<String, Object> form(String driverName, String name) throws IOException {
        DriverSet ds = AsCodeReader.read(tree);
        Driver d = driver(ds, driverName);
        Form form = d.provisioning.formByName(name);
        if (form == null) {
            throw new TreeService.NotFound("driver '" + driverName + "' has no form '" + name + "'");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("driver", d.name);
        m.put("name", form.name);
        m.put("kind", form.kind.dir);
        m.put("file", "drivers/" + AsCodeWriter.fileSafe(d.name) + "/provisioning/forms/" + form.kind.dir + "/" + AsCodeWriter.fileSafe(form.name) + ".form.json");
        m.put("json", form.json);
        List<Object> usedBy = new ArrayList<>();
        for (Prd p : d.provisioning.prds) {
            for (Prd.FormBinding b : p.bindings()) {
                if (form.name.equals(b.formId)) {
                    Map<String, Object> u = new LinkedHashMap<>();
                    u.put("prd", p.name);
                    u.put("activity", b.activityId);
                    List<String> mapped = new ArrayList<>();
                    for (Prd.Field f : b.fields) {
                        mapped.add(f.name);
                    }
                    u.put("fields", mapped);
                    usedBy.add(u);
                }
            }
        }
        m.put("usedBy", usedBy);
        return m;
    }

    /** The role and resource catalog of every driver that has one. */
    public Map<String, Object> catalog() throws IOException {
        DriverSet ds = AsCodeReader.read(tree);
        List<Object> roles = new ArrayList<>();
        List<Object> resources = new ArrayList<>();
        List<String> drivers = new ArrayList<>();
        for (Driver d : ds.drivers) {
            if (d.provisioning == null) {
                continue;
            }
            drivers.add(d.name);
            for (AppObject o : d.provisioning.objects) {
                AppObject.Kind k = o.kind();
                if (k != AppObject.Kind.ROLE && k != AppObject.Kind.RESOURCE) {
                    continue;
                }
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("driver", d.name);
                m.put("name", o.name());
                m.put("path", o.path());
                m.put("displayName", o.displayName());
                m.put("container", o.parentPath());
                m.put("attrs", o.attrs);
                (k == AppObject.Kind.ROLE ? roles : resources).add(m);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("drivers", drivers);
        out.put("roles", roles);
        out.put("resources", resources);
        return out;
    }
}
