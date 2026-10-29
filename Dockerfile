# Stage 1: Build React/Vite frontend
FROM node:22-alpine AS web-build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
COPY apps/web ./apps/web
RUN npm run build

# Stage 2: Build Spring Boot JAR with embedded frontend static assets
FROM gradle:8.14.3-jdk21 AS api-build
WORKDIR /workspace/apps/api
COPY apps/api .
COPY --from=web-build /workspace/apps/web/dist /workspace/apps/web/dist
RUN gradle --no-daemon bootJar -x test

# Stage 3: Minimal production runtime
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S holdem && adduser -S holdem -G holdem
COPY --from=api-build /workspace/apps/api/build/libs/holdem-api-0.1.0.jar app.jar
USER holdem
ENV SPRING_PROFILES_ACTIVE=local
ENV SESSION_COOKIE_SECURE=true
EXPOSE 8080
ENTRYPOINT ["java", "-Xmx384m", "-jar", "app.jar"]
