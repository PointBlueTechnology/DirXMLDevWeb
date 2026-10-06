# DirXMLDevWeb hosted: the server, the page, and the idm CLI, on a JRE with git.
# The image never carries the NetIQ/OpenText engine jars: the customer mounts them at /opt/idm/lib.
# Build with hosted/docker/build.sh, which gathers the artifacts from the two checkouts.
FROM eclipse-temurin:21-jre
RUN apt-get update && apt-get install -y --no-install-recommends git python3 curl ca-certificates openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1100 idmweb
WORKDIR /opt/idmweb
COPY artifacts/dirxml-dev-web.jar /opt/idmweb/lib/dirxml-dev-web.jar
COPY artifacts/dirxml-dev.jar     /opt/idmweb/lib/dirxml-dev.jar
COPY artifacts/dirxml-simulator.jar /opt/idmweb/lib/dirxml-simulator.jar
COPY artifacts/dist               /opt/idmweb/web/dist
COPY artifacts/secrets            /opt/idmweb/bin/secrets
COPY artifacts/terraform          /opt/idmweb/terraform
COPY bin/idm bin/idmweb bin/entrypoint.sh /opt/idmweb/bin/
RUN chmod +x /opt/idmweb/bin/* /opt/idmweb/bin/secrets/* && mkdir -p /var/lib/idmweb /etc/idmweb /opt/idm/lib \
    && chown -R idmweb:idmweb /var/lib/idmweb /etc/idmweb && ln -s /opt/idmweb/bin/idm /usr/local/bin/idm
USER idmweb
# a repository mounted into the container is owned by another uid; git refuses it otherwise
RUN git config --global --add safe.directory '*' && git config --global init.defaultBranch main
ENV IDM_HOME=/opt/idmweb IDM_LIB=/opt/idm/lib IDM_ENVIRONMENTS=/etc/idmweb/environments.properties
VOLUME ["/var/lib/idmweb"]
EXPOSE 8080
ENTRYPOINT ["/opt/idmweb/bin/entrypoint.sh"]
CMD ["serve", "--hosted", "/etc/idmweb/hosted.properties"]
