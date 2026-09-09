FROM rust:1.79
WORKDIR /app
COPY . .
RUN cargo build --release
CMD ["./target/release/furlpay-validator"]
