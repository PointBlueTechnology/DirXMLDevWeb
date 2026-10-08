package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.xml.CanonicalXml;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/** The events of a cache's simulator-ready document ({@code <nds><input>…</input></nds>}), one by one. */
final class CacheEvents {
    private CacheEvents() {
    }

    /** The children of {@code <input>}, in cache order. */
    static List<Element> events(String inputXds) {
        List<Element> out = new ArrayList<>();
        if (inputXds == null || inputXds.isBlank()) {
            return out;
        }
        Document doc = CanonicalXml.parse(inputXds);
        NodeList inputs = doc.getElementsByTagName("input");
        if (inputs.getLength() == 0) {
            return out;
        }
        NodeList kids = inputs.item(0).getChildNodes();
        for (int i = 0; i < kids.getLength(); i++) {
            if (kids.item(i).getNodeType() == Node.ELEMENT_NODE) {
                out.add((Element) kids.item(i));
            }
        }
        return out;
    }

    /** {@code <nds dtdversion="4.0"><input>event</input></nds>}: one event as a simulator input. */
    static String inputOf(Element event) {
        Document doc = CanonicalXml.parse("<nds dtdversion=\"4.0\"><input/></nds>");
        Element input = (Element) doc.getElementsByTagName("input").item(0);
        input.appendChild(doc.importNode(event, true));
        return CanonicalXml.serialize(doc.getDocumentElement());
    }

    static String leaf(Element e) {
        String dn = e.hasAttribute("src-dn") ? e.getAttribute("src-dn") : e.getAttribute("qualified-src-dn");
        if (dn == null || dn.isEmpty()) {
            return "";
        }
        int i = dn.lastIndexOf('\\');
        return i < 0 ? dn : dn.substring(i + 1);
    }

    /** What the page lists for an event: its position (1-based), operation, class, DN, event id; the XML when asked. */
    static Map<String, Object> summary(int index, Element e, boolean withXml) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("index", index + 1);
        m.put("operation", e.getTagName());
        m.put("className", e.hasAttribute("class-name") ? e.getAttribute("class-name") : null);
        m.put("srcDn", e.hasAttribute("src-dn") ? e.getAttribute("src-dn") : e.hasAttribute("qualified-src-dn") ? e.getAttribute("qualified-src-dn") : null);
        m.put("eventId", e.hasAttribute("event-id") ? e.getAttribute("event-id") : null);
        if (withXml) {
            m.put("xml", CanonicalXml.serialize(e));
        }
        return m;
    }
}
