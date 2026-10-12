export default function Fontes({ fontes }) {
    if (!fontes?.length) return null;
    return (
        <ul className="fontes">
            {fontes.map(f => (
                <li key={f.url}>
                    <a href={f.url} target="_blank" rel="noopener noreferrer">{f.titulo}</a>
                </li>
            ))}
        </ul>
    );
}
