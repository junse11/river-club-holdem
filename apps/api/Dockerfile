FROM gradle:8.14.3-jdk21 AS build
WORKDIR /app
COPY . .
RUN gradle --no-daemon test bootJar
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S holdem && adduser -S holdem -G holdem
COPY --from=build /app/build/libs/holdem-api-0.1.0.jar app.jar
USER holdem
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
