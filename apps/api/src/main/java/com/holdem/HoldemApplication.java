package com.holdem;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
public class HoldemApplication {
    public static void main(String[] args) { SpringApplication.run(HoldemApplication.class, args); }
}
