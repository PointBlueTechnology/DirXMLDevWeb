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
COPY artifacts/dirxml-trace-core.jar /opt/idmweb/lib/dirxml-trace-core.jar
COPY artifacts/postgresql.jar        /opt/idmweb/lib/postgresql.jar
COPY artifacts/jldap.jar             /opt/idmweb/lib/jldap.jar
COPY artifacts/console-auth.jar      /opt/idmweb/lib/console-auth.jar
COPY artifacts/dist               /opt/idmweb/web/dist
COPY artifacts/secrets            /opt/idmweb/bin/secrets
COPY artifacts/terraform          /opt/idmweb/terraform
COPY bin/idm bin/idmweb bin/entrypoint.sh /opt/idmweb/bin/
RUN chmod +x /opt/idmweb/bin/* /opt/idmweb/bin/secrets/* && mkdir -p /var/lib/idmweb /etc/idmweb /opt/idm/lib \
    && chown -R idmweb:idmweb /var/lib/idmweb /etc/idmweb && ln -s /opt/idmweb/bin/idm /usr/local/bin/idm \
    # a repository mounted into the container is owned by another uid, and the container may run as
    # the host's user (the single-user layout): git's rules live in the system config, not a home
    && git config --system --add safe.directory '*' && git config --system init.defaultBranch main
USER idmweb
ENV IDM_HOME=/opt/idmweb IDM_LIB=/opt/idm/lib IDM_ENVIRONMENTS=/etc/idmweb/environments.properties
VOLUME ["/var/lib/idmweb"]
EXPOSE 8080
ENTRYPOINT ["/opt/idmweb/bin/entrypoint.sh"]
CMD ["serve", "--hosted", "/etc/idmweb/hosted.properties"]
