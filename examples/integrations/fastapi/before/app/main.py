from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert

from .db import AsyncSession, session
from .models import Document, DocumentShare
from .permissions import bits_of, document_bits, project_bits, readable_documents, readable_projects

app = FastAPI()

not_found = {"error": "not found"}
forbidden = {"error": "forbidden"}


class Unauthorized(Exception):
    pass


@app.exception_handler(Unauthorized)
async def unauthorized(request: Request, error: Unauthorized):
    return JSONResponse({"error": "unauthorized"}, status_code=401)


# A real app reads the user from its session, this one from a header
def user_id(x_user_id: Annotated[str | None, Header()] = None) -> int:
    if x_user_id is None or not x_user_id.lstrip("-").isdigit():
        raise Unauthorized()
    return int(x_user_id)


UserId = Annotated[int, Depends(user_id)]
Session = Annotated[AsyncSession, Depends(session)]


class NewDocument(BaseModel):
    project_id: int
    title: str
    body: str = ""


class DocumentChange(BaseModel):
    title: str | None = None
    body: str | None = None


class Share(BaseModel):
    access: Literal["viewer", "editor"]


@app.get("/health")
async def health():
    return PlainTextResponse("ok")


@app.get("/projects")
async def projects(user: UserId, session: Session):
    return [{"id": id, "name": name} for id, name in await readable_projects(session, user)]


@app.get("/documents")
async def documents(user: UserId, session: Session):
    return [{"id": id, "project_id": project_id, "title": title} for id, project_id, title in await readable_documents(session, user)]


@app.get("/documents/{id}")
async def document(id: int, user: UserId, session: Session):
    bits = await document_bits(session, user, id)
    if not bits or "read" not in bits:
        return JSONResponse(not_found, status_code=404)
    return (await session.get_one(Document, id)).json()


@app.post("/documents", status_code=201)
async def create_document(new: NewDocument, user: UserId, session: Session):
    if "write" not in await project_bits(session, user, new.project_id):
        return JSONResponse(forbidden, status_code=403)
    document = Document(project_id=new.project_id, title=new.title, body=new.body)
    session.add(document)
    await session.commit()
    return document.json()


@app.patch("/documents/{id}")
async def update_document(id: int, change: DocumentChange, user: UserId, session: Session):
    bits = await document_bits(session, user, id)
    if not bits or "read" not in bits:
        return JSONResponse(not_found, status_code=404)
    if "write" not in bits:
        return JSONResponse(forbidden, status_code=403)
    document = await session.get_one(Document, id)
    for name, value in change.model_dump(exclude_unset=True).items():
        setattr(document, name, value)
    await session.commit()
    return document.json()


@app.delete("/documents/{id}")
async def delete_document(id: int, user: UserId, session: Session):
    bits = await document_bits(session, user, id)
    if not bits or "read" not in bits:
        return JSONResponse(not_found, status_code=404)
    if "delete" not in bits:
        return JSONResponse(forbidden, status_code=403)
    await session.delete(await session.get_one(Document, id))
    await session.commit()
    return Response(status_code=204)


@app.put("/documents/{id}/shares/{user_id}")
async def share_document(id: int, user_id: int, share: Share, user: UserId, session: Session):
    bits = await document_bits(session, user, id)
    if not bits or "read" not in bits:
        return JSONResponse(not_found, status_code=404)
    previous = await session.get(DocumentShare, (id, user_id))
    if not bits_of[share.access] <= bits or (previous and not bits_of[previous.access] <= bits):
        return JSONResponse(forbidden, status_code=403)
    await session.execute(
        insert(DocumentShare)
        .values(document_id=id, user_id=user_id, access=share.access)
        .on_conflict_do_update(index_elements=["document_id", "user_id"], set_={"access": share.access})
    )
    await session.commit()
    return Response(status_code=204)
