fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::compile_protos("proto/world_events.proto")?;
    Ok(())
}